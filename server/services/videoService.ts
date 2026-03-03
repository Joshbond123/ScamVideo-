import path from 'path';
import fs from 'fs-extra';
import axios from 'axios';
import FormData from 'form-data';
import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import { resolveCloudflareAccountId, withKeyFailover } from './keyService';
import { readJson, PATHS } from '../db';
import { deleteSupabaseAssets, pruneSupabaseTempAssets, renderVideoViaSupabaseFunction } from './supabaseStorage';

type GeneratedScript = {
  title: string;
  hook: string;
  script: string;
  scenes: Array<{ text: string; imagePrompt: string }>;
  preCtaScene: { text: string; imagePrompt: string };
  cta: string;
  caption: string;
  hashtags: string;
};

type VoiceTimingWord = { word: string; start: number; end: number };
type VoiceoverMeta = {
  voiceId: string;
  timingSource: string;
  words: VoiceTimingWord[];
  durationSec: number;
};

type OverlayAssetType = 'post_image' | 'video_scene';

const UNREAL_VOICES = ['Oliver', 'Noah', 'Ethan', 'Daniel'];
const voiceMetaByJob = new Map<string, VoiceoverMeta>();

function toSeconds(value: unknown) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return Number.NaN;
  if (raw >= 1_000) return raw / 1_000;
  return raw;
}


function sanitizeVideoImagePrompt(prompt: string) {
  const base = String(prompt || '').replace(/\s+/g, ' ').trim();
  return `${base}. Cinematic photoreal scene, visual storytelling only. Absolutely no readable text, letters, words, numbers, captions, subtitles, logos, signs, UI labels, or watermarks in the image.`;
}

function extractJsonObject(raw: string) {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('Model did not return JSON payload');
  }
}

async function runCerebrasJson(systemPrompt: string, userPrompt: string) {
  return withKeyFailover('cerebras', async (key) => {
    const response = await axios.post(
      'https://api.cerebras.ai/v1/chat/completions',
      {
        model: 'gpt-oss-120b',
        temperature: 0.7,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      },
      {
        headers: { Authorization: `Bearer ${key.key}` },
        timeout: 120_000,
      }
    );

    const content = String(response.data?.choices?.[0]?.message?.content || '');
    return extractJsonObject(content);
  });
}

export async function rewriteTopicForVideo(niche: string, topic: string): Promise<string> {
  const out = await runCerebrasJson(
    'Rewrite trending headlines into concise viral social-video topics. Output JSON only.',
    `Niche: ${niche}\nOriginal topic: ${topic}\nReturn JSON: {"topic":""}. Keep it factual, attention-grabbing, <= 16 words, no emojis.`
  );
  return String(out?.topic || topic).trim() || topic;
}

function normalizeScriptPayload(payload: any, topic: string): GeneratedScript {
  const scenes = Array.isArray(payload?.scenes)
    ? payload.scenes
        .map((s: any) => ({ text: String(s?.text || '').trim(), imagePrompt: String(s?.imagePrompt || '').trim() }))
        .filter((s: any) => s.text && s.imagePrompt)
    : [];

  return {
    title: String(payload?.title || topic).trim(),
    hook: String(payload?.hook || '').trim(),
    script: String(payload?.script || '').trim(),
    scenes: scenes.slice(0, 8),
    preCtaScene: {
      text:
        String(payload?.preCtaScene?.text || '').trim() ||
        'If you already sent crypto to scammers, check our link in bio or pinned comment to report your case and start your recovery review.',
      imagePrompt:
        String(payload?.preCtaScene?.imagePrompt || '').trim() ||
        'Concerned crypto scam victim speaking with a cybercrime support specialist in a modern office, cinematic lighting, vertical composition, no text',
    },
    cta: String(payload?.cta || '').trim() || 'Follow for scam alerts, like this video, and share to protect more people from crypto scams.',
    caption: String(payload?.caption || '').trim(),
    hashtags: String(payload?.hashtags || '').trim(),
  };
}

export async function generateScript(niche: string, topic: string): Promise<GeneratedScript> {
  const payload = await runCerebrasJson(
    'You create high-retention short-form anti-scam video scripts for Facebook. Return strict JSON only.',
    `Current date: ${new Date().toISOString()}\nNiche: ${niche}\nTrending topic: ${topic}\n\nReturn JSON exactly as:\n{\n  "title": "",\n  "hook": "",\n  "script": "",\n  "scenes": [{"text":"","imagePrompt":""}],\n  "preCtaScene": {"text":"","imagePrompt":""},\n  "cta": "",\n  "caption": "",\n  "hashtags": ""\n}\n\nRules:\n- scenes: 6-8 entries, each vivid, factual, dynamic, no placeholders.\n- Add one professional preCtaScene specifically telling victims who sent crypto to scammers to check link in bio/comments to report case and recover lost crypto.\n- cta must ask viewers to follow, like, and share.\n- imagePrompt must request cinematic vertical 9:16 visuals and explicitly say no text/watermarks/logos.\n- hashtags: exactly 5.`
  );

  return normalizeScriptPayload(payload, topic);
}

export async function generateFacebookComment(title: string, caption: string, topic: string, appendUrl?: string) {
  const base = await withKeyFailover('cerebras', async (key) => {
    const response = await axios.post(
      'https://api.cerebras.ai/v1/chat/completions',
      {
        model: 'gpt-oss-120b',
        messages: [
          {
            role: 'system',
            content:
              'Write one concise Facebook comment (35-75 words), factual and engaging, tied to topic/title. Professional tone. No markdown. No hashtags. Mention no upfront fees. Final sentence should guide crypto scam victims to report via provided link if available.',
          },
          {
            role: 'user',
            content: `Topic: ${topic}\nTitle: ${title}\nCaption: ${caption}`,
          },
        ],
      },
      {
        headers: { Authorization: `Bearer ${key.key}` },
        timeout: 120_000,
      }
    );

    return String(response.data.choices?.[0]?.message?.content || '').trim();
  });

  if (!appendUrl) return base;
  return `${base}\n\nIf you already sent crypto to scammers, use this link to report your case: ${appendUrl}`;
}

function normalizeWordTimings(raw: any): VoiceTimingWord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry: any) => {
      const word = String(entry?.word || entry?.text || '').trim();
      const start = toSeconds(entry?.start ?? entry?.start_time ?? entry?.from ?? entry?.offset);
      const duration = toSeconds(entry?.duration);
      const end = toSeconds(entry?.end ?? entry?.end_time ?? entry?.to ?? (Number.isFinite(start) ? start + duration : Number.NaN));
      if (!word || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      return { word, start, end };
    })
    .filter(Boolean) as VoiceTimingWord[];
}

function chooseRandomVoice() {
  return UNREAL_VOICES[Math.floor(Math.random() * UNREAL_VOICES.length)];
}

function toAssTime(seconds: number) {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total - Math.floor(total)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function buildSubtitleEventsFromWords(words: VoiceTimingWord[]) {
  const events: Array<{ text: string; start: number; end: number }> = [];
  for (let i = 0; i < words.length; i += 3) {
    const chunk = words.slice(i, i + 3);
    events.push({
      text: chunk.map((w) => w.word).join(' '),
      start: chunk[0].start,
      end: chunk[chunk.length - 1].end,
    });
  }
  return events;
}

async function writeAssSubtitle(jobId: string, events: Array<{ text: string; start: number; end: number }>) {
  const assPath = path.join(process.cwd(), 'database/assets/videos', `${jobId}.ass`);
  await fs.ensureDir(path.dirname(assPath));

  const ass = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    '',
    '[V4+ Styles]',
    'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
    'Style: Viral,Arial,58,&H00FFFFFF,&H0000FFFF,&H00332200,&H66000000,1,0,0,0,100,100,0,0,3,3,0,2,60,60,120,1',
    '',
    '[Events]',
    'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text',
  ];

  for (const ev of events) {
    const safe = ev.text.replace(/,/g, '\\,').replace(/\{/g, '(').replace(/\}/g, ')');
    ass.push(`Dialogue: 0,${toAssTime(ev.start)},${toAssTime(ev.end)},Viral,,0,0,0,,${safe}`);
  }

  await fs.writeFile(assPath, ass.join('\n'), 'utf8');
  const dialogueLines = Math.max(0, ass.length - 13);
  console.info(`[subtitle:${jobId}] ass_created path=${assPath} dialogue_lines=${dialogueLines}`);
  return assPath;
}

export async function generateVoiceover(text: string, jobId: string) {
  const filePath = path.join(process.cwd(), 'database/assets/audio', `${jobId}.mp3`);
  await fs.ensureDir(path.dirname(filePath));

  const voiceId = chooseRandomVoice();

  const out = await withKeyFailover('unrealspeech', async (key) => {
    const response = await axios.post(
      'https://api.v8.unrealspeech.com/speech',
      {
        Text: text,
        VoiceId: voiceId,
        Bitrate: '192k',
        OutputFormat: 'mp3',
        TimestampType: 'word',
        Speed: -0.05,
      },
      {
        headers: {
          Authorization: `Bearer ${key.key}`,
          'Content-Type': 'application/json',
        },
        timeout: 120_000,
      }
    );

    const audioUrl = String(response.data?.AudioUrl || response.data?.audio_url || response.data?.OutputUri || '');
    const timestampsUri = String(response.data?.TimestampsUri || response.data?.timestamps_uri || '');
    let timings = normalizeWordTimings(response.data?.Timestamps || response.data?.timestamps || response.data?.word_timestamps || []);
    console.info(`[voiceover:${jobId}] timing_data:initial_count=${timings.length} source=response_payload`);

    if (!audioUrl) throw new Error(`UnrealSpeech response missing audio URL: ${JSON.stringify(response.data || {})}`);

    if (!timings.length && timestampsUri) {
      const tsResp = await axios.get(timestampsUri, { timeout: 120_000 });
      timings = normalizeWordTimings(tsResp.data?.timestamps || tsResp.data?.words || tsResp.data || []);
      console.info(`[voiceover:${jobId}] timing_data:loaded_from_uri=${timestampsUri} count=${timings.length}`);
    }

    const audioResp = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 120_000 });
    await fs.writeFile(filePath, Buffer.from(audioResp.data));

    if (!timings.length) {
      console.warn(`[voiceover:${jobId}] UnrealSpeech returned audio without word timings; rendering will continue without burned subtitles.`);
    }

    return {
      filePath,
      voiceId,
      words: timings,
      timingSource: timings.length ? (timestampsUri ? 'unrealspeech_timestamps_uri' : 'unrealspeech_word_timestamps') : 'none',
      durationSec: Number(timings[timings.length - 1].end || 0),
    };
  });

  voiceMetaByJob.set(jobId, {
    voiceId: out.voiceId,
    words: out.words,
    timingSource: out.timingSource,
    durationSec: out.durationSec,
  });

  console.info(`[voiceover:${jobId}] selected_voice=${out.voiceId} timing_source=${out.timingSource} words=${out.words.length} duration_sec=${out.durationSec.toFixed(2)}`);
  return out.filePath;
}

async function generateLocalPlaceholderImage(jobId: string, sceneIdx: number) {
  const dir = path.join(process.cwd(), 'database/assets/images', jobId);
  await fs.ensureDir(dir);
  const filePath = path.join(dir, `scene_${sceneIdx}.png`);

  const response = await axios.get('https://picsum.photos/1080/1920', {
    responseType: 'arraybuffer',
    timeout: 30_000,
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });

  await fs.writeFile(filePath, response.data);
  return filePath;
}

async function generateImageWithPollinations(prompt: string, jobId: string, sceneIdx: number) {
  const dir = path.join(process.cwd(), 'database/assets/images', jobId);
  await fs.ensureDir(dir);
  const filePath = path.join(dir, `scene_${sceneIdx}.png`);

  const strictPrompt = sanitizeVideoImagePrompt(prompt);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(strictPrompt)}?width=1080&height=1920&nologo=true`;
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60_000,
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });

  await fs.writeFile(filePath, response.data);
  return filePath;
}

export async function generateImage(prompt: string, jobId: string, sceneIdx: number) {
  const accountId = await resolveCloudflareAccountId();

  if (accountId) {
    try {
      return await withKeyFailover('workers-ai', async (key) => {
        const response = await axios.post(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
          {
            prompt: sanitizeVideoImagePrompt(prompt),
            negative_prompt: 'text, words, letters, numbers, captions, subtitles, logo, watermark, signage, UI',
            steps: 6,
          },
          {
            headers: { Authorization: `Bearer ${key.key}`, 'Content-Type': 'application/json' },
            timeout: 60_000,
          }
        );

        const dir = path.join(process.cwd(), 'database/assets/images', jobId);
        await fs.ensureDir(dir);
        const filePath = path.join(dir, `scene_${sceneIdx}.png`);

        const base64 = response?.data?.result?.image || response?.data?.image;
        if (!base64 || typeof base64 !== 'string') {
          throw new Error(`Workers AI response missing image payload: ${JSON.stringify(response?.data || {})}`);
        }

        await fs.writeFile(filePath, Buffer.from(base64, 'base64'));
        return filePath;
      });
    } catch (error) {
      console.warn(`[image:${jobId}:${sceneIdx}] Workers AI failed; falling back to Pollinations:`, error);
    }
  } else {
    console.warn(`[image:${jobId}:${sceneIdx}] Cloudflare account id missing; skipping Workers AI and using fallbacks.`);
  }

  try {
    return await generateImageWithPollinations(prompt, jobId, sceneIdx);
  } catch (fallbackError) {
    console.warn(`[image:${jobId}:${sceneIdx}] Pollinations failed; using local placeholder image:`, fallbackError);
    return generateLocalPlaceholderImage(jobId, sceneIdx);
  }
}


async function renderVideoLocallyWithFfmpeg(args: string[]) {
  if (!ffmpegStatic) throw new Error('ffmpeg-static binary is unavailable for this platform');

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegStatic, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (error) => reject(error));
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-4000)}`));
    });
  });
}

async function assembleVideoLocally(jobId: string, audioPath: string, imagePaths: string[], subtitleAssPath?: string) {
  const outputPath = path.join(process.cwd(), 'database/assets/videos', `${jobId}.mp4`);
  await fs.ensureDir(path.dirname(outputPath));

  const concatFile = path.join(process.cwd(), 'database/assets/videos', `${jobId}_images.txt`);
  const durationSec = Math.max(3, Number((voiceMetaByJob.get(jobId)?.durationSec || 0).toFixed(2)) || imagePaths.length * 3);
  const perImage = Math.max(2.5, durationSec / Math.max(1, imagePaths.length));

  const lines: string[] = [];
  for (const img of imagePaths) {
    const safePath = img.replace(/'/g, "'\''");
    lines.push(`file '${safePath}'`);
    lines.push(`duration ${perImage.toFixed(3)}`);
  }
  if (imagePaths.length) {
    const last = imagePaths[imagePaths.length - 1].replace(/'/g, "'\''");
    lines.push(`file '${last}'`);
  }
  await fs.writeFile(concatFile, lines.join('\n'), 'utf8');

  const vfParts = ['scale=1080:1920:force_original_aspect_ratio=increase', 'crop=1080:1920', 'format=yuv420p'];
  if (subtitleAssPath) {
    const escaped = subtitleAssPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/,/g, '\\,');
    vfParts.push(`subtitles='${escaped}'`);
  }

  const ffmpegArgs = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatFile,
    '-i', audioPath,
    '-vf', vfParts.join(','),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    outputPath,
  ];

  console.info(`[render:${jobId}] ffmpeg_command=${[String(ffmpegStatic), ...ffmpegArgs].join(' ')}`);
  await renderVideoLocallyWithFfmpeg(ffmpegArgs);

  if (subtitleAssPath) {
    console.info(`[render:${jobId}] subtitles_applied=true subtitle_source=${subtitleAssPath}`);
  } else {
    console.info(`[render:${jobId}] subtitles_applied=false reason=no_subtitle_file`);
  }

  await fs.remove(concatFile).catch(() => undefined);
  return outputPath;
}

export async function addTitleOverlayToImage(imagePath: string, _title: string, assetType: OverlayAssetType) {
  if (assetType !== 'post_image') {
    console.warn(`[overlay] blocked assetType=${assetType} path=${imagePath}`);
    return imagePath;
  }

  // Intentionally no-op for now. We keep this hook for post image pipeline only.
  console.info(`[overlay] post_image overlay hook path=${imagePath}`);
  return imagePath;
}

export async function generatePostImageWithTitleOverlay(prompt: string, title: string, jobId: string) {
  const cleanPrompt = `${prompt}. No text, letters, words, logo, watermark, typography.`;
  const imagePath = await generateImage(cleanPrompt, jobId, 0);
  return addTitleOverlayToImage(imagePath, title, 'post_image');
}

export async function assembleVideo(jobId: string, audioPath: string, imagePaths: string[], subtitleLines: string[]) {
  console.info(`[render:${jobId}] render_provider=local_ffmpeg_with_supabase_fallback`);

  const meta = voiceMetaByJob.get(jobId);
  let subtitleEvents: Array<{ text: string; start: number; end: number }> = [];
  let subtitleAssPath = '';

  if (meta?.words?.length) {
    console.info(`[render:${jobId}] timing_data:using_words=${meta.words.length} source=${meta.timingSource}`);
    subtitleEvents = buildSubtitleEventsFromWords(meta.words);
    subtitleAssPath = await writeAssSubtitle(jobId, subtitleEvents);
    console.info(`[render:${jobId}] subtitle_file=${subtitleAssPath} subtitle_events=${subtitleEvents.length}`);
  } else {
    console.warn(`[render:${jobId}] missing word-level timing metadata; rendering without burned subtitles`);
  }

  try {
    const localOutput = await assembleVideoLocally(jobId, audioPath, imagePaths, subtitleAssPath || undefined);
    console.info(`[render:${jobId}] local_ffmpeg_render=success output=${localOutput}`);
    return localOutput;
  } catch (localError: any) {
    console.warn(`[render:${jobId}] local ffmpeg render failed; falling back to Supabase function`, localError?.message || localError);
  }

  const remote = await renderVideoViaSupabaseFunction({
    jobId,
    audioPath,
    imagePaths,
    subtitleLines,
    subtitleEvents,
    subtitleAss: subtitleAssPath ? await fs.readFile(subtitleAssPath, 'utf8') : '',
    voiceoverMeta: meta,
  });

  if (!remote?.localOutput) {
    throw new Error(`[render:${jobId}] both local and Supabase rendering failed: missing outputPath/localOutput`);
  }

  console.info(`[render:${jobId}] supabase_fallback_render=success subtitles_burned=${String(remote.subtitlesBurned)} output=${remote.outputPath || remote.localOutput} duration_sec=${Number(remote.outputDurationSec || 0).toFixed(2)} status=${remote.renderStatus || 'unknown'}`);
  return remote.localOutput;
}

export async function uploadToCatbox(filePath: string) {
  const hash = await readJson<any>(PATHS.settings).then((s) => s?.catboxHash);
  if (!hash) throw new Error('Catbox hash not configured');

  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('userhash', hash);
  form.append('fileToUpload', fs.createReadStream(filePath));

  const response = await axios.post('https://catbox.moe/user/api.php', form, {
    headers: form.getHeaders(),
    timeout: 120_000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  return response.data;
}

export async function cleanupJobAssets(jobId: string) {
  const audioPath = path.join(process.cwd(), 'database/assets/audio', `${jobId}.mp3`);
  const imageDir = path.join(process.cwd(), 'database/assets/images', jobId);
  const videoPath = path.join(process.cwd(), 'database/assets/videos', `${jobId}.mp4`);
  const subtitlePath = path.join(process.cwd(), 'database/assets/videos', `${jobId}.ass`);
  await Promise.all([fs.remove(audioPath), fs.remove(imageDir), fs.remove(videoPath), fs.remove(subtitlePath)]);
  voiceMetaByJob.delete(jobId);

  try {
    await deleteSupabaseAssets([
      `jobs/${jobId}/audio.mp3`,
      `jobs/${jobId}/render.mp4`,
      `jobs/${jobId}/subtitles.ass`,
      ...Array.from({ length: 16 }).map((_, idx) => `jobs/${jobId}/scene_${idx}.png`),
    ]);
  } catch (error) {
    console.warn(`[cleanup:${jobId}] Supabase storage cleanup skipped:`, error);
  }

  try {
    await pruneSupabaseTempAssets('jobs/', 24, 1_500_000_000);
  } catch (error) {
    console.warn(`[cleanup:${jobId}] Supabase pruning skipped:`, error);
  }
}

export async function cleanupPostImageAsset(imagePath: string) {
  await fs.remove(imagePath);
}
