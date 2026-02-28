import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs-extra';
import axios from 'axios';
import FormData from 'form-data';
import { withKeyFailover } from './keyService';
import { readJson, PATHS } from '../db';

export async function generateScript(niche: string, topic: string) {
  return withKeyFailover('cerebras', async (key) => {
    const response = await axios.post('https://api.cerebras.ai/v1/chat/completions', {
      model: 'llama3.1-70b',
      messages: [
        {
          role: 'system',
          content: `You are a viral content creator. Create a 1-minute video script about: ${niche}. Topic: ${topic}. Return JSON format: { "title": "", "script": "", "scenes": [{ "text": "", "imagePrompt": "" }], "caption": "", "hashtags": "" }`
        }
      ]
    }, {
      headers: { 'Authorization': `Bearer ${key.key}` }
    });

    return JSON.parse(response.data.choices[0].message.content);
  });
}

export async function generateVoiceover(text: string, jobId: string) {
  return withKeyFailover('unrealspeech', async (key) => {
    const response = await axios.post('https://api.unrealspeech.com/stream', {
      Text: text,
      VoiceId: 'Will',
      Bitrate: '192k',
      Speed: '0',
      Pitch: '1.0'
    }, {
      headers: { 'Authorization': `Bearer ${key.key}` },
      responseType: 'arraybuffer'
    });

    const filePath = path.join(process.cwd(), 'database/assets/audio', `${jobId}.mp3`);
    await fs.writeFile(filePath, response.data);
    return filePath;
  });
}

export async function generateImage(prompt: string, jobId: string, sceneIdx: number) {
  return withKeyFailover('workers-ai', async (key) => {
    const accountId = key.name?.trim();
    if (!accountId) {
      throw new Error('Workers AI key label must contain Cloudflare account id');
    }

    const response = await axios.post(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/bytedance/stable-diffusion-xl-lightning`, {
      prompt
    }, {
      headers: { 'Authorization': `Bearer ${key.key}` },
      responseType: 'arraybuffer'
    });

    const dir = path.join(process.cwd(), 'database/assets/images', jobId);
    await fs.ensureDir(dir);
    const filePath = path.join(dir, `scene_${sceneIdx}.png`);
    await fs.writeFile(filePath, response.data);
    return filePath;
  });
}

export async function assembleVideo(jobId: string, audioPath: string, imagePaths: string[]) {
  const outputPath = path.join(process.cwd(), 'database/assets/videos', `${jobId}.mp4`);

  return new Promise<string>((resolve, reject) => {
    let command = ffmpeg();

    imagePaths.forEach((img) => {
      command = command.input(img).loop(5);
    });

    command
      .input(audioPath)
      .complexFilter([
        'concat=n=' + imagePaths.length + ':v=1:a=0[v]',
        '[v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[v_cropped]'
      ], ['v_cropped'])
      .outputOptions([
        '-pix_fmt yuv420p',
        '-shortest'
      ])
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
    headers: form.getHeaders()
  });

  return response.data;
}


export async function cleanupJobAssets(jobId: string) {
  const audioPath = path.join(process.cwd(), 'database/assets/audio', `${jobId}.mp3`);
  const imageDir = path.join(process.cwd(), 'database/assets/images', jobId);
  const videoPath = path.join(process.cwd(), 'database/assets/videos', `${jobId}.mp4`);

  await Promise.all([
    fs.remove(audioPath),
    fs.remove(imageDir),
    fs.remove(videoPath)
  ]);
}
