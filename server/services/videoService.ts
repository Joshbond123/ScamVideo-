import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs-extra';
import axios from 'axios';
import FormData from 'form-data';
import { withKeyFailover } from './keyService';
import { readJson, PATHS } from '../db';

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

export async function generateVoiceover(text: string, jobId: string) {
  return withKeyFailover('unrealspeech', async (key) => {
    const response = await axios.post(
      'https://api.unrealspeech.com/stream',
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
      }
    );

    const filePath = path.join(process.cwd(), 'database/assets/audio', `${jobId}.mp3`);
    await fs.writeFile(filePath, response.data);
    return filePath;
  });
}

export async function generateImage(prompt: string, jobId: string, sceneIdx: number) {
  return withKeyFailover('workers-ai', async (key) => {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || key.name?.trim();
    if (!accountId) {
      throw new Error('Cloudflare account id missing. Set CLOUDFLARE_ACCOUNT_ID or use key label as account id.');
    }

    const response = await axios.post(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-2-dev`,
      {
        prompt,
      },
      {
        headers: { Authorization: `Bearer ${key.key}` },
        responseType: 'arraybuffer',
      }
    );

    const dir = path.join(process.cwd(), 'database/assets/images', jobId);
    await fs.ensureDir(dir);
    const filePath = path.join(dir, `scene_${sceneIdx}.png`);
    await fs.writeFile(filePath, response.data);
    return filePath;
  });
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
  return text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/%/g, '\\%').replace(/\n/g, '\\\\n');
}

export async function addTitleOverlayToImage(imagePath: string, title: string) {
  const overlayPath = imagePath.replace(/\.png$/, '_overlay.png');
  const escapedText = escapeForDrawText(wrapTitle(title));

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
