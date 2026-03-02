import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import path from 'path';
import fs from 'fs-extra';
import axios from 'axios';
import FormData from 'form-data';
import { resolveCloudflareAccountId, withKeyFailover } from './keyService';
import { readJson, PATHS } from '../db';

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

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

if (ffprobeStatic?.path) {
  ffmpeg.setFfprobePath(ffprobeStatic.path);
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

  const baseScenes = scenes.slice(0, 8);
  const preCtaScene = {
    text:
      String(payload?.preCtaScene?.text || '').trim() ||
      `If you already sent crypto in this ${topic} scam pattern, check our link in bio or pinned comment to report the case and start your recovery review.`,
    imagePrompt:
      String(payload?.preCtaScene?.imagePrompt || '').trim() ||
      'Concerned crypto scam victim speaking with a cybercrime support specialist in a modern office, cinematic lighting, vertical composition, no text',
  };

  return {
    title: String(payload?.title || topic).trim(),
    hook: String(payload?.hook || '').trim(),
    script: String(payload?.script || '').trim(),
    scenes: baseScenes,
    preCtaScene,
    cta:
      String(payload?.cta || '').trim() ||
      'Follow for scam alerts, like if this helped, and share this video to protect more people.',
    caption: String(payload?.caption || '').trim(),
    hashtags: String(payload?.hashtags || '').trim(),
  };
}

export async function generateScript(niche: string, topic: string): Promise<GeneratedScript> {
  const payload = await runCerebrasJson(
    'You create high-retention short-form anti-scam video scripts for Facebook. Return strict JSON only.',
    `Current date: ${new Date().toISOString()}\nNiche: ${niche}\nTrending topic: ${topic}\n
Return JSON exactly as:\n{
  "title": "",
  "hook": "",
  "script": "",
  "scenes": [{"text":"","imagePrompt":""}],
  "preCtaScene": {"text":"","imagePrompt":""},
  "cta": "",
  "caption": "",
  "hashtags": ""
}\n
Rules:\n- scenes: 6-8 entries, each vivid, factual, dynamic, no placeholders.\n- Add one professional preCtaScene specifically telling victims who sent crypto to scammers to check link in bio/comments to report case and recover lost crypto.\n- cta must be topic-based and ONLY ask viewers to follow, like, and share.\n- imagePrompt must request cinematic vertical 9:16 visuals and explicitly say no text/watermarks/logos.\n- hashtags: exactly 5.`
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
              'Write one concise Facebook comment (35-75 words), factual and engaging, tied to topic/title. Professional tone. No markdown. No hashtags. Mention no upfront fees. Only the final CTA sentence may mention scam victims reporting their case via link if a URL is provided.',
          },
          {
            role: 'user',
            content: `Topic: ${topic}\nTitle: ${title}\nCaption: ${caption}`,
          },
        ],
      },
      {
        headers: { Authorization: `Bearer ${key.key}` },
      }
    );

    return String(response.data.choices?.[0]?.message?.content || '').trim();
  });

  if (!appendUrl) return base;
  return `${base}\n\nIf you already sent crypto to scammers, use this link to report your case: ${appendUrl}`;
}


function chunkTextForTts(text: string, maxLen = 180) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxLen) {
      current = next;
      continue;
    }

    if (current) chunks.push(current);
    current = word;
  }

  if (current) chunks.push(current);
  return chunks.length ? chunks : [text.slice(0, maxLen)];
}

async function generateVoiceoverWithGoogleTts(text: string, jobId: string) {
  const outputPath = path.join(process.cwd(), 'database/assets/audio', `${jobId}.mp3`);
  const partsDir = path.join(process.cwd(), 'database/assets/audio', `${jobId}_parts`);
  await fs.ensureDir(partsDir);

  const chunks = chunkTextForTts(text);
  const partBuffers: Buffer[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const response = await axios.get('https://translate.google.com/translate_tts', {
      params: {
        ie: 'UTF-8',
        client: 'tw-ob',
        tl: 'en',
        q: chunk,
      },
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
      timeout: 30_000,
    });

    partBuffers.push(Buffer.from(response.data));
  }

  const outputBuffer = Buffer.concat(partBuffers);
  await fs.writeFile(outputPath, outputBuffer);

  await fs.remove(partsDir);
  return outputPath;
}

export async function generateVoiceover(text: string, jobId: string) {
  const filePath = path.join(process.cwd(), 'database/assets/audio', `${jobId}.mp3`);

  try {
    return await withKeyFailover('unrealspeech', async (key) => {
      const endpoints = ['https://api.v7.unrealspeech.com/stream', 'https://api.unrealspeech.com/stream'];
      let lastError: unknown;

      for (const endpoint of endpoints) {
        try {
          const response = await axios.post(
            endpoint,
            {
              Text: text,
              VoiceId: 'Will',
              Bitrate: '192k',
              OutputFormat: 'mp3',
              Speed: 0,
              Pitch: 1,
            },
            {
              headers: {
                Authorization: `Bearer ${key.key}`,
                Accept: 'audio/mpeg,application/octet-stream,*/*',
              },
              responseType: 'arraybuffer',
              timeout: 60_000,
            }
          );

          const buffer = Buffer.from(response.data || []);
          if (!buffer.length) throw new Error('UnrealSpeech returned empty audio payload');
          await fs.writeFile(filePath, buffer);
          return filePath;
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError instanceof Error ? lastError : new Error('UnrealSpeech request failed');
    });
  } catch (error) {
    console.warn(`[voiceover:${jobId}] UnrealSpeech unavailable, using Google TTS fallback`, error);
    return generateVoiceoverWithGoogleTts(text, jobId);
  }
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

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1080&height=1920&nologo=true`;
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
  if (!accountId) {
    throw new Error('Cloudflare account id missing. Set CLOUDFLARE_ACCOUNT_ID or save settings.cloudflareAccountId or config/CLOUDFLARE_ACCOUNT_ID in Supabase api_keys.');
  }

  try {
    return await withKeyFailover('workers-ai', async (key) => {
      const response = await axios.post(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
        {
          prompt,
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
    try {
      return await generateImageWithPollinations(prompt, jobId, sceneIdx);
    } catch (fallbackError) {
      console.warn(`[image:${jobId}:${sceneIdx}] Pollinations failed; using local placeholder image:`, fallbackError);
      return generateLocalPlaceholderImage(jobId, sceneIdx);
    }
  }
}

function wrapTitle(title: string, maxLineLength = 24, maxLines = 3) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];

  for (const word of words) {
    if (!lines.length) {
      lines.push(word);
      continue;
    }

    const current = lines[lines.length - 1];
    if (`${current} ${word}`.length <= maxLineLength) {
      lines[lines.length - 1] = `${current} ${word}`;
      continue;
    }

    if (lines.length < maxLines) {
      lines.push(word);
    } else {
      lines[lines.length - 1] = `${lines[lines.length - 1]}...`;
      break;
    }
  }

  return lines.join('\n');
}

function escapeForDrawText(text: string) {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/\n/g, '\\\\n');
}

export async function addTitleOverlayToImage(imagePath: string, title: string) {
  const overlayPath = imagePath.replace(/\.png$/, '_overlay.png');
  const escapedText = escapeForDrawText(wrapTitle(title));

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(imagePath)
        .outputOptions([
          '-vf',
          `drawbox=x=40:y=1250:w=1000:h=560:color=black@0.45:t=fill,drawtext=text='${escapedText}':fontcolor=white:fontsize=80:x=(w-text_w)/2:y=1400:line_spacing=20:box=0`,
        ])
        .frames(1)
        .on('end', () => resolve())
        .on('error', (error) => reject(error))
        .save(overlayPath);
    });

    return overlayPath;
  } catch (error) {
    console.warn('Title overlay failed; returning base generated image:', error);
    return imagePath;
  }
}


export async function generatePostImageWithTitleOverlay(prompt: string, title: string, jobId: string) {
  const cleanPrompt = `${prompt}. No text, letters, words, logo, watermark, typography.`;
  const imagePath = await generateImage(cleanPrompt, jobId, 0);
  return addTitleOverlayToImage(imagePath, title);
}

async function getAudioDurationSec(audioPath: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, data) => {
      if (err) return reject(err);
      const duration = Number(data?.format?.duration || 0);
      resolve(Number.isFinite(duration) && duration > 0 ? duration : 0);
    });
  });
}

function sanitizeSubtitleLine(line: string) {
  return line
    .replace(/[‘’]/g, "'")
    .replace(/[–—‑]/g, '-')
    .replace(/[^a-zA-Z0-9\s.,!?'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toAssTime(seconds: number) {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total - Math.floor(total)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

async function buildSubtitleFilters(lines: string[], totalDurationSec: number, jobId: string) {
  if (lines.length === 0 || totalDurationSec <= 0) return [] as string[];

  const perScene = Math.max(totalDurationSec / lines.length, 0.5);
  const safeLines = lines.map(sanitizeSubtitleLine).filter(Boolean);
  if (!safeLines.length) return [] as string[];

  const assPath = path.join(process.cwd(), 'database/assets/videos', `${jobId}.ass`);
  const assLines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    '',
    '[V4+ Styles]',
    'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
    'Style: Viral,Arial,54,&H00FFFFFF,&H000000FF,&H00000000,&H66000000,1,0,0,0,100,100,0,0,3,2,0,2,60,60,80,1',
    '',
    '[Events]',
    'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text',
  ];

  safeLines.forEach((line, i) => {
    const start = toAssTime(i * perScene);
    const end = toAssTime((i + 1) * perScene);
    const text = line.replace(/,/g, '\\,').replace(/\{/g, '(').replace(/\}/g, ')');
    assLines.push(`Dialogue: 0,${start},${end},Viral,,0,0,0,,${text}`);
  });

  await fs.writeFile(assPath, assLines.join('\n'), 'utf8');

  const escapedPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  return [`[v0]subtitles='${escapedPath}'[v_sub_0]`];
}

export async function assembleVideo(jobId: string, audioPath: string, imagePaths: string[], subtitleLines: string[]) {
  const outputPath = path.join(process.cwd(), 'database/assets/videos', `${jobId}.mp4`);

  const totalDurationSec = await getAudioDurationSec(audioPath);
  const baseFilters = [
    `concat=n=${imagePaths.length}:v=1:a=0[v]`,
    `[v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[v0]`,
  ];
  const subtitleFilters = await buildSubtitleFilters(subtitleLines, totalDurationSec, jobId);
  const allFilters = [...baseFilters, ...subtitleFilters];
  const outputLabel = subtitleFilters.length ? `[v_sub_${subtitleFilters.length - 1}]` : '[v0]';

  return new Promise<string>((resolve, reject) => {
    let command = ffmpeg();

    imagePaths.forEach((img) => {
      command = command.input(img).loop(5);
    });

    command
      .input(audioPath)
      .complexFilter(allFilters, [outputLabel.replace(/\[|\]/g, '')])
      .outputOptions(['-pix_fmt yuv420p', '-shortest'])
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
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
  });

  return response.data;
}

export async function cleanupJobAssets(jobId: string) {
  const audioPath = path.join(process.cwd(), 'database/assets/audio', `${jobId}.mp3`);
  const imageDir = path.join(process.cwd(), 'database/assets/images', jobId);
  const videoPath = path.join(process.cwd(), 'database/assets/videos', `${jobId}.mp4`);
  const subtitlePath = path.join(process.cwd(), 'database/assets/videos', `${jobId}.ass`);

  await Promise.all([fs.remove(audioPath), fs.remove(imageDir), fs.remove(videoPath), fs.remove(subtitlePath)]);
}

export async function cleanupPostImageAsset(imagePath: string) {
  await fs.remove(imagePath);
}
