import { createClient } from 'npm:@supabase/supabase-js@2.56.1';

type RenderRequest = {
  healthcheck?: boolean;
  jobId: string;
  bucket: string;
  audioPath: string;
  imagePaths: string[];
  subtitleAssPath?: string;
  outputPath?: string;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function toFsSafePath(rel: string) {
  return rel.replace(/^\/+/, '').replace(/\.\./g, '').replace(/\//g, '_');
}

async function downloadStorageObject(bucket: string, objectPath: string, localPath: string) {
  const { data, error } = await client.storage.from(bucket).download(objectPath);
  if (error || !data) throw new Error(`Failed to download ${bucket}/${objectPath}: ${error?.message || 'unknown error'}`);
  await Deno.writeFile(localPath, new Uint8Array(await data.arrayBuffer()));
}

async function runFfmpeg(args: string[]) {
  const command = new Deno.Command('ffmpeg', { args, stdout: 'piped', stderr: 'piped' });
  const out = await command.output();
  if (!out.success) {
    throw new Error(`ffmpeg failed: ${new TextDecoder().decode(out.stderr)}`);
  }
}

Deno.serve(async (request) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for render-video' }, 500);
  }

  const payload = (await request.json().catch(() => ({}))) as Partial<RenderRequest>;
  if (payload.healthcheck) return json({ ok: true, function: 'render-video' });

  if (!payload.jobId || !payload.bucket || !payload.audioPath || !Array.isArray(payload.imagePaths) || !payload.imagePaths.length) {
    return json({ error: 'Missing required fields: jobId, bucket, audioPath, imagePaths[]' }, 400);
  }

  const workDir = `/tmp/render-${toFsSafePath(payload.jobId)}`;
  await Deno.mkdir(workDir, { recursive: true });

  const audioFile = `${workDir}/audio.mp3`;
  await downloadStorageObject(payload.bucket, payload.audioPath, audioFile);

  for (let i = 0; i < payload.imagePaths.length; i += 1) {
    await downloadStorageObject(payload.bucket, payload.imagePaths[i], `${workDir}/scene_${i}.png`);
  }

  const subtitleFile = `${workDir}/subtitles.ass`;
  let subtitleFilter = '';
  if (payload.subtitleAssPath) {
    await downloadStorageObject(payload.bucket, payload.subtitleAssPath, subtitleFile);
    subtitleFilter = `,subtitles=${subtitleFile}`;
  }

  const outputPath = payload.outputPath || `jobs/${payload.jobId}/render.mp4`;
  const outputFile = `${workDir}/output.mp4`;
  const videoFilter = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p${subtitleFilter}`;

  await runFfmpeg([
    '-y', '-framerate', '1/3', '-i', `${workDir}/scene_%d.png`, '-i', audioFile,
    '-vf', videoFilter,
    '-c:v', 'libx264', '-preset', 'veryfast',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', outputFile,
  ]);

  const bytes = await Deno.readFile(outputFile);
  const { error: uploadError } = await client.storage.from(payload.bucket).upload(outputPath, bytes, {
    contentType: 'video/mp4',
    upsert: true,
  });
  if (uploadError) return json({ error: `Upload failed: ${uploadError.message}` }, 500);

  const { data: signedData } = await client.storage.from(payload.bucket).createSignedUrl(outputPath, 3600);

  return json({
    status: 'success',
    outputPath,
    signedUrl: signedData?.signedUrl,
    subtitlesBurned: Boolean(payload.subtitleAssPath),
    renderProvider: 'supabase_edge_ffmpeg',
  });
});
