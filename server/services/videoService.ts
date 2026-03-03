import path from 'path';
import fs from 'fs-extra';
import axios from 'axios';
import FormData from 'form-data';
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

type GeneratedViralPost = {
  title: string;
  imagePrompt: string;
  overlayText: string;
  caption: string;
  hashtags: string;
  victimCta: string;
};

type VoiceTimingWord = { word: string; start: number; end: number };
type VoiceoverMetadata = {
  voiceId: string;
  durationSec: number;
  timingSource: string;
  words: VoiceTimingWord[];
};

const voiceoverMetadataByJob = new Map<string, VoiceoverMetadata>();
const UNREAL_VOICES = ['Will', 'Scarlett', 'Dan', 'Liv'];

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
      { headers: { Authorization: `Bearer ${key.key}` } }
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
    cta:
      String(payload?.cta || '').trim() ||
      'Follow for scam alerts, like this video, and share to protect more people from crypto scams.',
    caption: String(payload?.caption || '').trim(),
    hashtags: String(payload?.hashtags || '').trim(),
  };
}

export async function generateScript(niche: string, topic: string): Promise<GeneratedScript> {
  const payload = await runCerebrasJson(
    'You create high-retention short-form anti-scam video scripts for Facebook. Return strict JSON only.',
    `Current date: ${new Date().toISOString()}\nNiche: ${niche}\nTrending topic: ${topic}\n\nReturn JSON exactly as:\n{\n  "title": "",\n  "hook": "",\n  "script": "",\n  "scenes": [{"text":"","imagePrompt":""}],\n  "preCtaScene": {"text":"","imagePrompt":""},\n  "cta": "",\n  "caption": "",\n  "hashtags": ""\n}\n\nRules:\n- scenes: 6-8 entries, each vivid, factual, dynamic, no placeholders.\n- Add one professional preCtaScene specifically telling victims who sent crypto to scammers to check link in bio/comments to report case and recover lost crypto.\n- cta must NOT be topic-based; it should only ask viewers to follow, like, and share to protect others.\n- imagePrompt must request cinematic vertical 9:16 visuals and explicitly say no text/watermarks/logos.\n- hashtags: exactly 5.`
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
              'Write one concise Facebook comment (35-75 words), factual and engaging, tied to topic/title. Professional tone. No markdown. No hashtags. Mention no upfront fees. The final CTA sentence must focus only on scam victims reporting their case; this CTA must not be topic-specific.',
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

  if (!appendUrl) return `${base}\n\nIf you already sent crypto to scammers, report your case using the link in our bio/comments.`;
  return `${base}\n\nIf you already sent crypto to scammers, use this link to report your case and start recovery: ${appendUrl}`;
}

export async function generateViralPost(niche: string, topic: string): Promise<GeneratedViralPost> {
  const payload = await runCerebrasJson(
    'You create high-performing viral anti-crypto-scam Facebook image posts. Return strict JSON only.',
    `Current date: ${new Date().toISOString()}\nNiche: ${niche}\nTopic: ${topic}\n\nReturn JSON exactly as:\n{\n  "title": "",\n  "imagePrompt": "",\n  "overlayText": "",\n  "caption": "",\n  "victimCta": "",\n  "hashtags": ""\n}\n\nRules:\n- title: strong hook, 8-16 words, attention-grabbing, factual.\n- overlayText: 2-4 short lines, viral style, readable, no hashtags.\n- caption: engaging viral-style post body based on topic, 90-170 words.\n- victimCta: MUST focus only on crypto scam victims and say if they already sent crypto they should click link in bio/comments to report the scam and recover lost crypto; include follow/like/share encouragement; do not make this CTA topic-based.\n- imagePrompt: cinematic vertical 9:16, no text, no logo, no watermark.\n- hashtags: exactly 5 hashtags relevant to the topic.`
  );

  const title = String(payload?.title || topic).trim();
  const caption = String(payload?.caption || '').trim();
  const victimCta = String(payload?.victimCta || '').trim() || 'If you already sent crypto to scammers, click the link in bio or comments to report your case and start recovery. Follow, like, and share to protect others.';
  return {
    title,
    caption,
    victimCta,
    hashtags: String(payload?.hashtags || '').trim(),
    overlayText: String(payload?.overlayText || title).trim(),
    imagePrompt: String(payload?.imagePrompt || `Viral anti-crypto scam alert visual about ${topic}, dramatic composition, vertical 9:16, no text, no logo, no watermark`).trim(),
  };
}

function normalizeWordTimings(raw: any): VoiceTimingWord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry: any) => {
      const word = String(entry?.word || entry?.text || '').trim();
      const start = Number(entry?.start ?? entry?.start_time ?? entry?.from ?? entry?.offset);
      const end = Number(entry?.end ?? entry?.end_time ?? entry?.to ?? (Number.isFinite(start) ? start + Number(entry?.duration || 0) : NaN));
      if (!word || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      return { word, start, end };
    })
    .filter(Boolean) as VoiceTimingWord[];
}

function selectRandomVoice() {
  return UNREAL_VOICES[Math.floor(Math.random() * UNREAL_VOICES.length)];
}

export function getVoiceoverMetadata(jobId: string): VoiceoverMetadata | null {
  return voiceoverMetadataByJob.get(jobId) || null;
}

export function buildSubtitleEventsFromVoiceover(jobId: string, fallbackLines: string[]) {
  const meta = getVoiceoverMetadata(jobId);
  if (!meta?.words?.length) {
    const joined = fallbackLines.join(' ').trim();
    if (!joined) return [];
    return [{ text: joined, start: 0, end: 3.5 }];
  }

  const events: Array<{ text: string; start: number; end: number }> = [];
  for (let i = 0; i < meta.words.length; i += 4) {
    const chunk = meta.words.slice(i, i + 4);
    const text = chunk.map((w) => w.word).join(' ');
    events.push({ text, start: chunk[0].start, end: chunk[chunk.length - 1].end });
  }
  return events;
}

export async function generateVoiceover(text: string, jobId: string) {
  const filePath = path.join(process.cwd(), 'database/assets/audio', `${jobId}.mp3`);
  await fs.ensureDir(path.dirname(filePath));
  const voiceId = selectRandomVoice();

  const result = await withKeyFailover('unrealspeech', async (key) => {
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
        headers: { Authorization: `Bearer ${key.key}`, 'Content-Type': 'application/json' },
        timeout: 120_000,
      }
    );

    const audioUrl = String(response.data?.AudioUrl || response.data?.OutputUri || response.data?.audio_url || '');
    const timingsRaw = response.data?.Timestamps || response.data?.timestamps || response.data?.word_timestamps || [];
    const words = normalizeWordTimings(timingsRaw);
    if (!audioUrl) throw new Error(`UnrealSpeech response missing audio URL: ${JSON.stringify(response.data || {})}`);
    if (!words.length) throw new Error(`UnrealSpeech response missing word timestamps: ${JSON.stringify(response.data || {})}`);

    const audioResp = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 120_000 });
    await fs.writeFile(filePath, Buffer.from(audioResp.data));

    return {
      filePath,
      voiceId,
      words,
      durationSec: Number(words[words.length - 1].end || 0),
      timingSource: 'unrealspeech_word_timestamps',
    };
  });

  voiceoverMetadataByJob.set(jobId, {
    voiceId: result.voiceId,
    words: result.words,
    durationSec: result.durationSec,
    timingSource: result.timingSource,
  });

  console.log(`[voiceover:${jobId}] selectedVoice=${result.voiceId} timingSource=${result.timingSource} words=${result.words.length} durationSec=${result.durationSec.toFixed(2)}`);
  return filePath;
}

async function generateLocalPlaceholderImage(jobId: string, sceneIdx: number) {
  const dir = path.join(process.cwd(), 'database/assets/images', jobId);
  await fs.ensureDir(dir);
  const filePath = path.join(dir, `scene_${sceneIdx}.png`);
  const response = await axios.get('https://picsum.photos/1080/1920', { responseType: 'arraybuffer', timeout: 30_000, headers: { 'User-Agent': 'Mozilla/5.0' } });
  await fs.writeFile(filePath, response.data);
  return filePath;
}

async function generateImageWithPollinations(prompt: string, jobId: string, sceneIdx: number) {
  const dir = path.join(process.cwd(), 'database/assets/images', jobId);
  await fs.ensureDir(dir);
  const filePath = path.join(dir, `scene_${sceneIdx}.png`);
  const response = await axios.get(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1080&height=1920&nologo=true`, {
    responseType: 'arraybuffer', timeout: 60_000, headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  await fs.writeFile(filePath, response.data);
  return filePath;
}

export async function generateImage(prompt: string, jobId: string, sceneIdx: number) {
  const accountId = await resolveCloudflareAccountId();
  if (!accountId) throw new Error('Cloudflare account id missing. Set CLOUDFLARE_ACCOUNT_ID or settings.cloudflareAccountId.');

  try {
    return await withKeyFailover('workers-ai', async (key) => {
      const response = await axios.post(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
        { prompt, steps: 6 },
        { headers: { Authorization: `Bearer ${key.key}`, 'Content-Type': 'application/json' }, timeout: 60_000 }
      );

      const dir = path.join(process.cwd(), 'database/assets/images', jobId);
      await fs.ensureDir(dir);
      const filePath = path.join(dir, `scene_${sceneIdx}.png`);
      const base64 = response?.data?.result?.image || response?.data?.image;
      if (!base64 || typeof base64 !== 'string') throw new Error(`Workers AI response missing image payload: ${JSON.stringify(response?.data || {})}`);
      await fs.writeFile(filePath, Buffer.from(base64, 'base64'));
      return filePath;
    });
  } catch (error) {
    console.warn(`[image:${jobId}:${sceneIdx}] Workers AI failed; falling back to Pollinations`, error);
    try {
      return await generateImageWithPollinations(prompt, jobId, sceneIdx);
    } catch {
      return generateLocalPlaceholderImage(jobId, sceneIdx);
    }
  }
}

export async function addTitleOverlayToImage(imagePath: string, _title: string) {
  return imagePath;
}

export async function generatePostImageWithTitleOverlay(prompt: string, title: string, jobId: string) {
  const cleanPrompt = `${prompt}. No text, letters, words, logo, watermark, typography.`;
  const imagePath = await generateImage(cleanPrompt, jobId, 0);
  return addTitleOverlayToImage(imagePath, title);
}

export async function assembleVideo(jobId: string, audioPath: string, imagePaths: string[], subtitleLines: string[]) {
  const subtitleEvents = buildSubtitleEventsFromVoiceover(jobId, subtitleLines);
  console.log(`[render:${jobId}] subtitleEvents=${subtitleEvents.length}`);

  const remote = await renderVideoViaSupabaseFunction({
    jobId,
    audioPath,
    imagePaths,
    subtitleLines,
    subtitleEvents,
    voiceover: getVoiceoverMetadata(jobId),
  });

  if (!remote?.localOutput) throw new Error('Supabase render function did not return outputPath/localOutput');

  if (subtitleEvents.length) {
    console.log(`[render:${jobId}] subtitles_burned=true firstEvent=${JSON.stringify(subtitleEvents[0])}`);
  }
  console.log(`[render:${jobId}] finalOutput=${remote.localOutput}`);
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
  });

  return response.data;
}

export async function cleanupJobAssets(jobId: string) {
  const audioPath = path.join(process.cwd(), 'database/assets/audio', `${jobId}.mp3`);
  const imageDir = path.join(process.cwd(), 'database/assets/images', jobId);
  const videoPath = path.join(process.cwd(), 'database/assets/videos', `${jobId}.mp4`);
  await Promise.all([fs.remove(audioPath), fs.remove(imageDir), fs.remove(videoPath)]);
  voiceoverMetadataByJob.delete(jobId);

  try {
    await deleteSupabaseAssets([
      `jobs/${jobId}/audio.mp3`,
      `jobs/${jobId}/render.mp4`,
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
