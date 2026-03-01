import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import path from 'path';
import fs from 'fs-extra';
import axios from 'axios';
import FormData from 'form-data';
import { withKeyFailover } from './keyService';
import { readJson, PATHS } from '../db';

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

if (ffprobeStatic?.path) {
  ffmpeg.setFfprobePath(ffprobeStatic.path);
}

export async function generateScript(niche: string, topic: string) {
  return withKeyFailover('cerebras', async (key) => {
    const response = await axios.post(
      'https://api.cerebras.ai/v1/chat/completions',
      {
        model: 'gpt-oss-120b',
        messages: [
          {
            role: 'system',
            content: `You are an expert social content strategist focused on timely, factual and highly engaging Facebook content.\nCurrent date/time: ${new Date().toISOString()}\nNiche: ${niche}\nSelected trending topic: ${topic}\nCreate a 1-minute script based only on this topic and avoid generic filler.\nReturn strict JSON format: { "title": "", "script": "", "scenes": [{ "text": "", "imagePrompt": "" }], "caption": "", "hashtags": "" }\nRules:\n- scenes must be 6-12 entries with punchy scene text and vivid imagePrompt.\n- caption must be hook-style and policy-safe for Facebook.\n- hashtags must contain exactly 5 viral hashtags related to the title/topic.`,
          },
        ],
      },
      {
        headers: { Authorization: `Bearer ${key.key}` },
      }
    );

    return JSON.parse(response.data.choices[0].message.content);
  });
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
              'Write one concise Facebook comment (35-75 words), factual and engaging, tied to the provided topic and title. No markdown. No emojis spam. Do not include hashtags.',
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
  return `${base}\n\n${appendUrl}`;
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
      const endpoints = ['https://api.unrealspeech.com/stream', 'https://api.v8.unrealspeech.com/stream'];
      let lastError: unknown;

      for (const endpoint of endpoints) {
        try {
          const response = await axios.post(
            endpoint,
            {
              Text: text,
              VoiceId: 'Will',
              Bitrate: '192k',
              Speed: '0',
              Pitch: '1.0',
            },
            {
              headers: { Authorization: `Bearer ${key.key}` },
              responseType: 'arraybuffer',
              timeout: 45_000,
            }
          );

          await fs.writeFile(filePath, response.data);
          return filePath;
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError instanceof Error ? lastError : new Error('UnrealSpeech request failed');
    });
  } catch (error) {
    console.warn('UnrealSpeech failed; falling back to free Google TTS:', error);
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
  try {
    return await withKeyFailover('workers-ai', async (key) => {
      const keyLabel = (key.name || '').trim();
      const accountIdFromLabel = /^[a-f0-9]{32}$/i.test(keyLabel) ? keyLabel : '';
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || accountIdFromLabel;
      if (!accountId) {
        throw new Error('Cloudflare account id missing. Set CLOUDFLARE_ACCOUNT_ID or name workers-ai key with 32-char account id.');
      }

      const response = await axios.post(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-2-dev`,
        {
          prompt,
        },
        {
          headers: { Authorization: `Bearer ${key.key}` },
          responseType: 'arraybuffer',
          timeout: 60_000,
        }
      );

      const dir = path.join(process.cwd(), 'database/assets/images', jobId);
      await fs.ensureDir(dir);
      const filePath = path.join(dir, `scene_${sceneIdx}.png`);
      await fs.writeFile(filePath, response.data);
      return filePath;
    });
  } catch (error) {
    console.warn('Workers AI image generation failed; falling back to Pollinations:', error);
    try {
      return await generateImageWithPollinations(prompt, jobId, sceneIdx);
    } catch (fallbackError) {
      console.warn('Pollinations fallback failed; using local placeholder image:', fallbackError);
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

function buildSubtitleFilters(lines: string[], totalDurationSec: number) {
  if (process.env.ENABLE_VIDEO_SUBTITLES !== 'true') {
    return [] as string[];
  }

  if (lines.length === 0 || totalDurationSec <= 0) return [] as string[];

  const perScene = Math.max(totalDurationSec / lines.length, 0.5);
  const filters: string[] = [];

  lines.forEach((line, i) => {
    const start = Number((i * perScene).toFixed(2));
    const end = Number(((i + 1) * perScene).toFixed(2));
    const input = i === 0 ? '[v0]' : `[v_sub_${i - 1}]`;
    const output = `[v_sub_${i}]`;
    const text = escapeForDrawText(line);

    filters.push(
      `${input}drawbox=x=40:y=h-360:w=w-80:h=260:color=black@0.35:t=fill,drawtext=text='${text}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=h-250:enable='between(t,${start},${end})'${output}`
    );
  });

  return filters;
}

export async function assembleVideo(jobId: string, audioPath: string, imagePaths: string[], subtitleLines: string[]) {
  const outputPath = path.join(process.cwd(), 'database/assets/videos', `${jobId}.mp4`);

  const totalDurationSec = await getAudioDurationSec(audioPath);
  const baseFilters = [
    `concat=n=${imagePaths.length}:v=1:a=0[v]`,
    `[v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[v0]`,
  ];
  const subtitleFilters = buildSubtitleFilters(subtitleLines, totalDurationSec);
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

  await Promise.all([fs.remove(audioPath), fs.remove(imageDir), fs.remove(videoPath)]);
}

export async function cleanupPostImageAsset(imagePath: string) {
  await fs.remove(imagePath);
}
