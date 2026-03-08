import path from 'path';
import fs from 'fs-extra';
import axios from 'axios';
import FormData from 'form-data';
import { resolveCloudflareAccountId, withKeyFailover } from './keyService';
import { readJson, PATHS } from '../db';
import { deleteSupabaseAssets, pruneSupabaseTempAssets } from './supabaseStorage';
import { renderVideoViaGitHubActions } from './githubRenderService';

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

type BackgroundTrack = {
  title: string;
  url: string;
  volume: number;
};

type VoiceTimingWord = { word: string; start: number; end: number };
type VoiceoverMeta = {
  voiceId: string;
  timingSource: string;
  words: VoiceTimingWord[];
  durationSec: number;
};

const UNREAL_VOICES = ['Oliver', 'Noah', 'Ethan', 'Daniel'];
const BACKGROUND_TRACKS: BackgroundTrack[] = [
  { title: 'Helix Drive 1', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', volume: 0.08 },
  { title: 'Helix Drive 2', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3', volume: 0.08 },
  { title: 'Helix Drive 3', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3', volume: 0.08 },
  { title: 'Helix Drive 4', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3', volume: 0.08 },
  { title: 'Helix Drive 5', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3', volume: 0.08 },
];
let lastBackgroundTrackUrl: string | null = null;
const voiceMetaByJob = new Map<string, VoiceoverMeta>();

const PRE_CTA_VICTIM_SUPPORT_MESSAGE =
  'If you sent crypto to scammers, check the link in our bio or comments to report the scam and submit your case so investigators can help recover your lost crypto.';

function stripToSingleLine(value: string, maxLen: number) {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  return compact.slice(0, maxLen).trim();
}

function looksLikeCta(text: string) {
  const t = String(text || '').toLowerCase();
  return /(follow|like|share|subscribe|comment below|link in bio|check the link|report your case)/.test(t);
}

function sceneImagePromptFromNarration(sceneText: string, topic: string) {
  const scene = stripToSingleLine(sceneText, 260);
  const focusedTopic = stripToSingleLine(topic, 120);
  return `${scene}. Visualize this exact moment from the topic: ${focusedTopic}. Documentary realism, cinematic vertical 9:16, high detail, natural lighting, no text, no letters, no logos, no watermark.`;
}

function preCtaVictimSupportImagePrompt(sceneText: string) {
  const scene = stripToSingleLine(sceneText, 260);
  return `${scene}. Trustworthy crypto investigation office, analyst team reviewing blockchain wallet traces on secure dashboards, victim support specialist guiding a case intake, cinematic documentary realism, vertical 9:16, no text, no letters, no logos, no watermark.`;
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
        .map((s: any) => ({ text: stripToSingleLine(String(s?.text || ''), 220), imagePrompt: stripToSingleLine(String(s?.imagePrompt || ''), 260) }))
        .filter((s: any) => s.text)
        .filter((s: any) => !looksLikeCta(s.text))
        .slice(0, 8)
        .map((s: any) => ({
          text: s.text,
          imagePrompt: s.imagePrompt || sceneImagePromptFromNarration(s.text, topic),
        }))
    : [];

  const preCtaText = PRE_CTA_VICTIM_SUPPORT_MESSAGE;

  const cta =
    stripToSingleLine(String(payload?.cta || ''), 200) ||
    'Follow for real-time scam alerts, like this video, and share it to protect more people from this scam.';

  return {
    title: stripToSingleLine(String(payload?.title || topic), 120),
    hook: stripToSingleLine(String(payload?.hook || ''), 180),
    script: stripToSingleLine(String(payload?.script || ''), 1000),
    scenes,
    preCtaScene: {
      text: preCtaText,
      imagePrompt: preCtaVictimSupportImagePrompt(preCtaText),
    },
    cta,
    caption: stripToSingleLine(String(payload?.caption || ''), 240),
    hashtags: stripToSingleLine(String(payload?.hashtags || ''), 120),
  };
}

export async function generateScript(niche: string, topic: string): Promise<GeneratedScript> {
  const payload = await runCerebrasJson(
    'You create high-retention short-form anti-scam video scripts for Facebook. Return strict JSON only.',
    `Current date: ${new Date().toISOString()}
Niche: ${niche}
Single topic (must stay consistent from first second to final frame): ${topic}

Return JSON exactly as:
{
  "title": "",
  "hook": "",
  "script": "",
  "scenes": [{"text":"","imagePrompt":""}],
  "preCtaScene": {"text":"","imagePrompt":""},
  "cta": "",
  "caption": "",
  "hashtags": ""
}

Rules:
- Use one topic only: do not introduce other incidents, coins, scams, or side stories.
- Hook + scenes + cta must all stay on this exact topic.
- scenes: 6-8 entries, factual, dynamic, web-style informational details (names, amounts, timeline, mechanics, impact) tied to topic; avoid generic filler language.
- scenes must contain no CTA language (no follow/like/share/comment/link prompts).
- preCtaScene: one dedicated victim-assistance scene that appears immediately before final CTA, is NOT about the main topic, and tells viewers who sent crypto to scammers to use the link in bio/comments to report scam + submit case so investigators can help recover lost crypto.
- cta: exactly one final CTA line only, natural and professional, asking viewers to like, share, and follow, tied to this topic.
- imagePrompt must visually describe the same narration moment as its scene text, cinematic vertical 9:16, no text/watermarks/logos.
- hashtags: exactly 5.`
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
              'Write one professional Facebook comment in 55-95 words. Keep it engaging and primarily focused on the exact video topic, title, and caption. Include clear prompts to like this video, share it with others, and follow the page. No hashtags, no markdown, and no mention of pricing/fees. Do not mention victim reporting unless a link is provided by the caller.',
          },
          {
            role: 'user',
            content: `Topic: ${topic}
Title: ${title}
Caption: ${caption}`,
          },
        ],
      },
      {
        headers: { Authorization: `Bearer ${key.key}` },
        timeout: 120_000,
      }
    );

    const raw = stripToSingleLine(String(response.data.choices?.[0]?.message?.content || ''), 520);
    const cleaned = raw
      .replace(/\bno upfront fees?\b/gi, '')
      .replace(/\bwithout upfront fees?\b/gi, '')
      .replace(/\b(if you sent crypto to scammers|report (the )?crypto scam|submit your case|recovery options|link in (our )?(bio|comments?))\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const withTopic = cleaned || `This update on ${topic} highlights key details people need to watch closely.`;
    const engagementNudges = 'If this breakdown helped, like this video, share it with others, and follow our page for more verified scam updates.';
    const merged = `${withTopic} ${engagementNudges}`.replace(/\s{2,}/g, ' ').trim();
    return stripToSingleLine(merged, 520);
  });

  if (!appendUrl) return base;
  return `${base} If you sent crypto to scammers, click this link to report the crypto scam and submit your case so investigators can review recovery options: ${appendUrl}`;
}

function chooseRandomBackgroundTrack() {
  if (BACKGROUND_TRACKS.length <= 1) {
    const only = BACKGROUND_TRACKS[0];
    lastBackgroundTrackUrl = only?.url || null;
    return only;
  }

  const candidates = BACKGROUND_TRACKS.filter((track) => track.url !== lastBackgroundTrackUrl);
  const selected = candidates[Math.floor(Math.random() * candidates.length)] || BACKGROUND_TRACKS[0];
  lastBackgroundTrackUrl = selected.url;
  return selected;
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
    .filter(Boolean)
    .sort((a: VoiceTimingWord, b: VoiceTimingWord) => a.start - b.start) as VoiceTimingWord[];
}

function chooseRandomVoice() {
  return UNREAL_VOICES[Math.floor(Math.random() * UNREAL_VOICES.length)];
}

function buildSubtitleEventsFromWords(words: VoiceTimingWord[]) {
  const events: Array<{ text: string; start: number; end: number }> = [];
  let cursor = 0;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const next = words[i + 1];
    const start = Math.max(0, Number(word.start || 0), cursor);
    const nextStart = next ? Math.max(start + 0.04, Number(next.start || 0)) : Number.POSITIVE_INFINITY;
    const naturalEnd = Math.max(Number(word.end || 0), start + 0.1);
    const maxEndBeforeNext = Number.isFinite(nextStart) ? nextStart - 0.01 : Number.POSITIVE_INFINITY;
    const end = Math.max(start + 0.05, Math.min(naturalEnd, maxEndBeforeNext));
    const text = String(word.word || '').trim();
    if (!text) continue;
    events.push({
      text: text.toUpperCase(),
      start,
      end,
    });
    cursor = end;
  }
  return events;
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

    if (!audioUrl) throw new Error(`UnrealSpeech response missing audio URL: ${JSON.stringify(response.data || {})}`);

    if (!timings.length && timestampsUri) {
      const tsResp = await axios.get(timestampsUri, { timeout: 120_000 });
      timings = normalizeWordTimings(tsResp.data?.timestamps || tsResp.data?.words || tsResp.data || []);
    }

    if (!timings.length) throw new Error(`UnrealSpeech response missing word timestamps: ${JSON.stringify(response.data || {})}`);

    const audioResp = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 120_000 });
    await fs.writeFile(filePath, Buffer.from(audioResp.data));

    return {
      filePath,
      voiceId,
      words: timings,
      timingSource: timestampsUri ? 'unrealspeech_timestamps_uri' : 'unrealspeech_word_timestamps',
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
          width: 1080,
          height: 1920,
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

export async function addTitleOverlayToImage(imagePath: string, _title: string) {
  return imagePath;
}

export async function generatePostImageWithTitleOverlay(prompt: string, title: string, jobId: string) {
  const cleanPrompt = `${prompt}. No text, letters, words, logo, watermark, typography.`;
  const imagePath = await generateImage(cleanPrompt, jobId, 0);
  return addTitleOverlayToImage(imagePath, title);
}

export async function assembleVideo(jobId: string, audioPath: string, imagePaths: string[], subtitleLines: string[]) {
  console.info(`[render:${jobId}] render_provider=github_actions_remotion`);

  const meta = voiceMetaByJob.get(jobId);
  if (!meta?.words?.length) {
    throw new Error(`[render:${jobId}] missing UnrealSpeech timing metadata; cannot render synchronized subtitles`);
  }

  const subtitleEvents = buildSubtitleEventsFromWords(meta.words);
  const backgroundTrack = chooseRandomBackgroundTrack();
  console.info(`[render:${jobId}] subtitle_format=srt subtitle_events=${subtitleEvents.length}`);
  console.info(`[render:${jobId}] background_track_selected title=${backgroundTrack.title} volume=${backgroundTrack.volume}`);

  const remote = await renderVideoViaGitHubActions({
    jobId,
    audioPath,
    imagePaths,
    subtitleEvents,
    backgroundMusicUrl: backgroundTrack.url,
    backgroundMusicVolume: backgroundTrack.volume,
    voiceoverMeta: {
      voiceId: meta.voiceId,
      timingSource: meta.timingSource,
      durationSec: meta.durationSec,
    },
  });

  if (!remote?.localOutput) {
    throw new Error(`[render:${jobId}] render_provider=github_actions_remotion failed: missing local output`);
  }

  console.info(`[render:${jobId}] subtitles_burn_step=success output=${remote.outputPath || remote.localOutput} workflow_run=${remote.runUrl || 'n/a'}`);
  return remote.localOutput;
}

export async function uploadToCatbox(filePath: string) {
  const hash = await readJson<any>(PATHS.settings).then((s) => s?.catboxHash);
  if (!hash) throw new Error('Catbox hash not configured');

  let lastPayload = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
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

    const raw = String(response.data ?? '').trim();
    lastPayload = raw;
    const match = raw.match(/https?:\/\/[^\s]+/i);
    const candidate = (match?.[0] || raw).trim();

    try {
      const parsed = new URL(candidate);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('unsupported protocol');
      return parsed.toString();
    } catch {
      if (attempt >= 3) break;
      await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
    }
  }

  throw new Error(`Catbox upload did not return a valid URL. payload=${lastPayload.slice(0, 500)}`);
}

export async function cleanupJobAssets(jobId: string) {
  const audioPath = path.join(process.cwd(), 'database/assets/audio', `${jobId}.mp3`);
  const imageDir = path.join(process.cwd(), 'database/assets/images', jobId);
  const videoPath = path.join(process.cwd(), 'database/assets/videos', `${jobId}.mp4`);
  const subtitlePath = path.join(process.cwd(), 'database/assets/videos', `${jobId}.srt`);
  await Promise.all([fs.remove(audioPath), fs.remove(imageDir), fs.remove(videoPath), fs.remove(subtitlePath)]);
  voiceMetaByJob.delete(jobId);

  try {
    await deleteSupabaseAssets([
      `jobs/${jobId}/audio.mp3`,
      `jobs/${jobId}/render.mp4`,
      `jobs/${jobId}/subtitles.srt`,
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
