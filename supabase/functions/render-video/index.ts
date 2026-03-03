import { createClient } from 'npm:@supabase/supabase-js@2.56.1';

type RenderRequest = {
  healthcheck?: boolean;
  jobId: string;
  bucket: string;
  audioPath: string;
  imagePaths: string[];
  subtitleAssPath?: string;
  subtitleEvents?: Array<{ text?: string; start?: number; end?: number }>;
  voiceoverMeta?: { durationSec?: number; timingSource?: string } | null;
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

const RENDER_FUNCTION_NAME = 'render-video';
const RENDERER_VERSION = '2026.03-subtitle-timeline-v2';

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
  const stderrText = new TextDecoder().decode(out.stderr);
  if (!out.success) {
    throw new Error(`ffmpeg failed: ${stderrText}`);
  }
  return stderrText;
}


async function detectLibassSupport() {
  const command = new Deno.Command('ffmpeg', { args: ['-hide_banner', '-filters'], stdout: 'piped', stderr: 'piped' });
  const out = await command.output();
  const outputText = `${new TextDecoder().decode(out.stdout)}
${new TextDecoder().decode(out.stderr)}`;
  return out.success && /\bass\b/.test(outputText) && /\bsubtitles\b/.test(outputText);
}

Deno.serve(async (request) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for render-video' }, 500);
  }

  const rawBody = await request.json().catch(() => ({}));
  const payload = (((rawBody as Record<string, unknown>)?.payload as Partial<RenderRequest>) || rawBody || {}) as Partial<RenderRequest>;
  console.info(
    `[render-video] payload_received keys=${Object.keys((payload || {}) as Record<string, unknown>).join(',') || 'none'} has_jobId=${Boolean(payload.jobId)} has_bucket=${Boolean(payload.bucket)} has_audioPath=${Boolean(payload.audioPath)} image_count=${Array.isArray(payload.imagePaths) ? payload.imagePaths.length : 0}`
  );
  if (payload.healthcheck) {
    return json({
      ok: true,
      function: RENDER_FUNCTION_NAME,
      rendererVersion: RENDERER_VERSION,
      subtitleTimelineMode: 'concat',
      subtitleBurnMethod: 'ass_libass',
    });
  }

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

  const durationSec = Math.max(3, Number(payload.voiceoverMeta?.durationSec || 0) || payload.imagePaths.length * 3);
  const perImageSec = Math.max(2.5, durationSec / Math.max(1, payload.imagePaths.length));
  const concatFile = `${workDir}/images.txt`;
  const concatLines: string[] = [];
  for (let i = 0; i < payload.imagePaths.length; i += 1) {
    const scenePath = `${workDir}/scene_${i}.png`;
    concatLines.push(`file '${scenePath.replace(/'/g, "'\\''")}'`);
    concatLines.push(`duration ${perImageSec.toFixed(3)}`);
  }
  const lastScenePath = `${workDir}/scene_${payload.imagePaths.length - 1}.png`;
  concatLines.push(`file '${lastScenePath.replace(/'/g, "'\\''")}'`);
  await Deno.writeTextFile(concatFile, concatLines.join('\n'));
  console.info(`[render-video:${payload.jobId}] scene_timeline_mode=concat_voiceover_synced duration_sec=${durationSec.toFixed(2)} per_image_sec=${perImageSec.toFixed(3)} image_count=${payload.imagePaths.length}`);

  const subtitleFile = `${workDir}/subtitles.ass`;
  let subtitleFilter = '';
  if (payload.subtitleAssPath) {
    const supportsLibass = await detectLibassSupport();
    console.info(`[render-video:${payload.jobId}] ffmpeg_libass_support=${supportsLibass}`);
    if (!supportsLibass) {
      throw new Error('Edge ffmpeg build does not support libass ass/subtitles filters');
    }

    await downloadStorageObject(payload.bucket, payload.subtitleAssPath, subtitleFile);
    const subtitleContent = await Deno.readTextFile(subtitleFile);
    const subtitleInfo = await Deno.stat(subtitleFile);
    const dialogueLines = subtitleContent.split(/\r?\n/).filter((line) => line.startsWith('Dialogue:')).length;
    console.info(`[render-video:${payload.jobId}] subtitle_file_path=${subtitleFile} subtitle_size_bytes=${subtitleInfo.size} subtitle_line_count=${dialogueLines}`);
    const escapedSubtitlePath = subtitleFile.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/,/g, '\\,');
    subtitleFilter = `,ass='${escapedSubtitlePath}'`;
  }

  if (Array.isArray(payload.subtitleEvents)) {
    console.info(`[render-video:${payload.jobId}] subtitle_events_count=${payload.subtitleEvents.length} timing_source=${payload.voiceoverMeta?.timingSource || 'unknown'}`);
  }

  const outputPath = payload.outputPath || `jobs/${payload.jobId}/render.mp4`;
  const outputFile = `${workDir}/output.mp4`;
  const videoFilter = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p${subtitleFilter}`;

  const ffmpegArgs = [
    '-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-i', audioFile,
    '-vf', videoFilter,
    '-r', '30',
    '-c:v', 'libx264', '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', outputFile,
  ];

  console.info(`[render-video:${payload.jobId}] ffmpeg_command=ffmpeg ${ffmpegArgs.join(' ')}`);
  const ffmpegStderr = await runFfmpeg(ffmpegArgs);
  console.info(`[render-video:${payload.jobId}] ffmpeg_stderr_tail=${ffmpegStderr.slice(-4000)}`);
  const ffmpegSubtitleMessages = ffmpegStderr
    .split(/\r?\n/)
    .filter((line) => /libass|Parsed_ass|Added subtitle file|fontselect|font provider/i.test(line))
    .slice(-20);
  if (ffmpegSubtitleMessages.length) {
    console.info(`[render-video:${payload.jobId}] ffmpeg_subtitle_messages=${JSON.stringify(ffmpegSubtitleMessages)}`);
  }
  console.info(`[render-video:${payload.jobId}] burn_step_ran=true subtitles_requested=${Boolean(payload.subtitleAssPath)}`);
  if (payload.subtitleAssPath) {
    console.info(`[render-video:${payload.jobId}] burned_subtitles_into_video=true burn_method=libass_ass_filter`);
  }

  const bytes = await Deno.readFile(outputFile);
  const { error: uploadError } = await client.storage.from(payload.bucket).upload(outputPath, bytes, {
    contentType: 'video/mp4',
    upsert: true,
  });
  if (uploadError) return json({ error: `Upload failed: ${uploadError.message}` }, 500);

  const { data: signedData } = await client.storage.from(payload.bucket).createSignedUrl(outputPath, 3600);

  return json({
    status: 'success',
    function: RENDER_FUNCTION_NAME,
    rendererVersion: RENDERER_VERSION,
    outputPath,
    signedUrl: signedData?.signedUrl,
    subtitlesBurned: Boolean(payload.subtitleAssPath),
    renderProvider: 'supabase_edge_ffmpeg',
  });
});
