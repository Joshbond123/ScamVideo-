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

type VoiceTimingWord = { word: string; start: number; end: number };
type VoiceTimingSentence = { text: string; start: number; end: number };
type VoiceoverMeta = {
  voiceId: string;
  timingSource: string;
  words: VoiceTimingWord[];
  sentences: VoiceTimingSentence[];
  durationSec: number;
};

type OverlayAssetType = 'post_image' | 'video_scene';

const UNREAL_VOICES = ['Oliver', 'Noah', 'Ethan', 'Daniel'];
const voiceMetaByJob = new Map<string, VoiceoverMeta>();

function detectTimestampScale(raw: any): 1 | 0.001 {
  if (!Array.isArray(raw) || !raw.length) return 1;
  const numbers: number[] = [];
  for (const entry of raw) {
    const values = [entry?.start, entry?.start_time, entry?.from, entry?.offset, entry?.end, entry?.end_time, entry?.to, entry?.duration]
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v));
    numbers.push(...values);
  }

  if (!numbers.length) return 1;
  const max = Math.max(...numbers);
  // Speech clips are normally << 10 minutes. Very large timing values indicate ms-based timestamps.
  return max > 600 ? 0.001 : 1;
}

function scaleTiming(value: unknown, scale: 1 | 0.001) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return Number.NaN;
  return raw * scale;
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
  const scale = detectTimestampScale(raw);
  return raw
    .map((entry: any) => {
      const word = String(entry?.word || entry?.text || '').trim();
      const start = scaleTiming(entry?.start ?? entry?.start_time ?? entry?.from ?? entry?.offset, scale);
      const duration = scaleTiming(entry?.duration, scale);
      const end = scaleTiming(entry?.end ?? entry?.end_time ?? entry?.to ?? (Number.isFinite(start) ? start + duration : Number.NaN), scale);
      if (!word || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      return { word, start, end };
    })
    .filter(Boolean) as VoiceTimingWord[];
}

function normalizeSentenceTimings(raw: any): VoiceTimingSentence[] {
  if (!Array.isArray(raw)) return [];
  const scale = detectTimestampScale(raw);
  return raw
    .map((entry: any) => {
      const text = String(entry?.text || entry?.sentence || '').trim();
      const start = scaleTiming(entry?.start ?? entry?.start_time ?? entry?.from ?? entry?.offset, scale);
      const duration = scaleTiming(entry?.duration, scale);
      const end = scaleTiming(entry?.end ?? entry?.end_time ?? entry?.to ?? (Number.isFinite(start) ? start + duration : Number.NaN), scale);
      if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      return { text, start, end };
    })
    .filter(Boolean) as VoiceTimingSentence[];
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
  const maxWordsPerChunk = 3;
  const punctuationBreak = /[.!?,;:]$/;
  const hardCharLimit = 22;

  let i = 0;
  while (i < words.length) {
    const chunk: VoiceTimingWord[] = [];
    let charCount = 0;

    while (i < words.length && chunk.length < maxWordsPerChunk) {
      const candidate = words[i];
      if (!candidate) break;
      const nextCharCount = charCount + (chunk.length ? 1 : 0) + candidate.word.length;

      if (chunk.length && nextCharCount > hardCharLimit) break;

      chunk.push(candidate);
      charCount = nextCharCount;
      i += 1;

      if (punctuationBreak.test(candidate.word)) break;
    }

    if (!chunk.length) {
      i += 1;
      continue;
    }

    const start = chunk[0].start;
    const naturalEnd = chunk[chunk.length - 1].end;
    const next = words[i];
    const boundedEnd = next ? Math.min(naturalEnd, Math.max(start + 0.2, next.start - 0.02)) : naturalEnd;
    events.push({
      text: chunk.map((w) => w.word).join(' '),
      start,
      end: Math.max(boundedEnd, start + 0.28),
    });
  }

  return events;
}


function normalizeSubtitleEvents(events: Array<{ text: string; start: number; end: number }>, maxDurationSec?: number) {
  const sorted = [...events].sort((a, b) => a.start - b.start);
  const normalized: Array<{ text: string; start: number; end: number }> = [];
  const cap = Number.isFinite(maxDurationSec) ? Math.max(0.5, Number(maxDurationSec)) : Number.POSITIVE_INFINITY;

  for (const ev of sorted) {
    const rawText = String(ev.text || '').replace(/\s+/g, ' ').trim();
    if (!rawText) continue;

    const previousEnd = normalized.length ? normalized[normalized.length - 1].end : 0;
    const rawStart = Math.max(0, Number(ev.start) || 0);
    const rawEnd = Math.max(rawStart + 0.05, Number(ev.end) || 0);
    const start = Math.min(cap - 0.3, Math.max(rawStart, previousEnd + 0.02));
    const end = Math.min(cap, Math.max(rawEnd, start + 0.32));
    if (end <= start) continue;
    normalized.push({ text: rawText.toUpperCase(), start, end });
  }

  return normalized;
}

function buildSubtitleEventsFromLines(lines: string[], durationSec: number) {
  const clean = lines.map((l) => String(l || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!clean.length || !Number.isFinite(durationSec) || durationSec <= 0) return [] as Array<{ text: string; start: number; end: number }>;

  const span = durationSec / clean.length;
  return clean.map((text, idx) => {
    const start = idx * span;
    const end = idx === clean.length - 1 ? durationSec : (idx + 1) * span;
    return { text, start, end };
  });
}


function summarizeSubtitleTimeline(events: Array<{ text: string; start: number; end: number }>) {
  if (!events.length) return { count: 0, firstStart: 0, lastEnd: 0 };
  return {
    count: events.length,
    firstStart: events[0].start,
    lastEnd: events[events.length - 1].end,
  };
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
    // Keep captions in a social-safe area above the lower UI overlays used by Facebook/Reels.
    // BorderStyle=3 + BackColour provides a readable box on bright scenes.
    'Style: Viral,Arial,66,&H00FFFFFF,&H00FFFFFF,&H00000000,&H88000000,1,0,0,0,100,100,0,0,3,0,0,2,80,80,420,1',
    '',
    '[Events]',
    'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text',
  ];

  for (const ev of events) {
    const safe = ev.text.replace(/,/g, '\\,').replace(/\{/g, '(').replace(/\}/g, ')');
    ass.push(`Dialogue: 0,${toAssTime(ev.start)},${toAssTime(ev.end)},Viral,,0,0,0,,${safe}`);
  }

  await fs.writeFile(assPath, ass.join('\n'), 'utf8');
  const subtitleContent = await fs.readFile(assPath, 'utf8');
  const subtitleStats = await fs.stat(assPath);
  const dialogueLines = subtitleContent
    .split(/\r?\n/)
    .filter((line) => line.startsWith('Dialogue:'))
    .length;
  console.info(`[subtitle:${jobId}] ass_created path=${assPath} subtitle_size_bytes=${subtitleStats.size} dialogue_lines=${dialogueLines}`);
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
    const initialWordRaw = response.data?.Timestamps || response.data?.timestamps || response.data?.word_timestamps || [];
    const initialSentenceRaw = response.data?.SentenceTimestamps || response.data?.sentence_timestamps || [];
    let timings = normalizeWordTimings(initialWordRaw);
    let sentenceTimings = normalizeSentenceTimings(initialSentenceRaw);
    const initialWordScale = detectTimestampScale(initialWordRaw) === 0.001 ? 'ms' : 'sec';
    const initialSentenceScale = detectTimestampScale(initialSentenceRaw) === 0.001 ? 'ms' : 'sec';
    console.info(`[voiceover:${jobId}] timing_data:initial_word_count=${timings.length} initial_sentence_count=${sentenceTimings.length} source=response_payload`);
    console.info(`[voiceover:${jobId}] timing_unit_detected response_words=${initialWordScale} response_sentences=${initialSentenceScale}`);

    if (!audioUrl) throw new Error(`UnrealSpeech response missing audio URL: ${JSON.stringify(response.data || {})}`);

    if ((!timings.length || !sentenceTimings.length) && timestampsUri) {
      const tsResp = await axios.get(timestampsUri, { timeout: 120_000 });
      const uriWordRaw = tsResp.data?.timestamps || tsResp.data?.words || tsResp.data || [];
      const uriSentenceRaw = tsResp.data?.timestamps || tsResp.data?.sentences || tsResp.data || [];
      timings = normalizeWordTimings(uriWordRaw);
      sentenceTimings = normalizeSentenceTimings(uriSentenceRaw);
      const uriWordScale = detectTimestampScale(uriWordRaw) === 0.001 ? 'ms' : 'sec';
      const uriSentenceScale = detectTimestampScale(uriSentenceRaw) === 0.001 ? 'ms' : 'sec';
      console.info(`[voiceover:${jobId}] timing_data:loaded_from_uri=${timestampsUri} word_count=${timings.length} sentence_count=${sentenceTimings.length}`);
      console.info(`[voiceover:${jobId}] timing_unit_detected uri_words=${uriWordScale} uri_sentences=${uriSentenceScale}`);
    }

    const audioResp = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 120_000 });
    await fs.writeFile(filePath, Buffer.from(audioResp.data));

    if (!timings.length && !sentenceTimings.length) {
      console.warn(`[voiceover:${jobId}] UnrealSpeech returned audio without timing data; rendering will continue without burned subtitles.`);
    }

    return {
      filePath,
      voiceId,
      words: timings,
      sentences: sentenceTimings,
      timingSource: timings.length
        ? (timestampsUri ? 'unrealspeech_timestamps_uri_word' : 'unrealspeech_word_timestamps')
        : sentenceTimings.length
          ? (timestampsUri ? 'unrealspeech_timestamps_uri_sentence' : 'unrealspeech_sentence_timestamps')
          : 'none',
      durationSec: Number(timings[timings.length - 1]?.end || sentenceTimings[sentenceTimings.length - 1]?.end || 0),
    };
  });

  voiceMetaByJob.set(jobId, {
    voiceId: out.voiceId,
    words: out.words,
    sentences: out.sentences,
    timingSource: out.timingSource,
    durationSec: out.durationSec,
  });

  console.info(`[voiceover:${jobId}] selected_voice=${out.voiceId} timing_source=${out.timingSource} words=${out.words.length} sentences=${out.sentences.length} timestamps_received=${out.words.length || out.sentences.length} duration_sec=${out.durationSec.toFixed(2)}`);
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


export async function assembleVideo(jobId: string, audioPath: string, imagePaths: string[], subtitleLines: string[]) {
  console.info(`[render:${jobId}] render_provider=github_actions_gstreamer_only`);

  const meta = voiceMetaByJob.get(jobId);
  const durationSec = Math.max(3, Number(meta?.durationSec || 0) || imagePaths.length * 3);
  let subtitleEvents: Array<{ text: string; start: number; end: number }> = [];
  let subtitleAssPath = '';

  if (meta?.words?.length) {
    console.info(`[render:${jobId}] timing_data:using_words=${meta.words.length} source=${meta.timingSource}`);
    const timingSample = meta.words.slice(0, 5).map((w) => `${w.word}:${w.start.toFixed(2)}-${w.end.toFixed(2)}`).join('|');
    console.info(`[render:${jobId}] timing_data_sample=${timingSample}`);
    subtitleEvents = normalizeSubtitleEvents(buildSubtitleEventsFromWords(meta.words), durationSec);
    subtitleAssPath = await writeAssSubtitle(jobId, subtitleEvents);
    console.info(`[render:${jobId}] subtitle_file=${subtitleAssPath} subtitle_events=${subtitleEvents.length}`);
  } else if (meta?.sentences?.length) {
    const timingSample = meta.sentences.slice(0, 3).map((s) => `${s.text.slice(0, 20)}:${s.start.toFixed(2)}-${s.end.toFixed(2)}`).join('|');
    console.info(`[render:${jobId}] timing_data:using_sentences=${meta.sentences.length} source=${meta.timingSource} sample=${timingSample}`);
    subtitleEvents = normalizeSubtitleEvents(meta.sentences.map((s) => ({ text: s.text, start: s.start, end: s.end })), durationSec);
    subtitleAssPath = await writeAssSubtitle(jobId, subtitleEvents);
    console.info(`[render:${jobId}] subtitle_file=${subtitleAssPath} subtitle_events=${subtitleEvents.length}`);
  } else {
    console.warn(`[render:${jobId}] missing timing metadata; attempting subtitleLines duration fallback`);
    subtitleEvents = normalizeSubtitleEvents(buildSubtitleEventsFromLines(subtitleLines, durationSec), durationSec);
    if (subtitleEvents.length) {
      subtitleAssPath = await writeAssSubtitle(jobId, subtitleEvents);
      console.info(`[render:${jobId}] subtitle_fallback=subtitle_lines duration_sec=${durationSec.toFixed(2)} subtitle_events=${subtitleEvents.length}`);
    }
  }

  if (subtitleEvents.length) {
    const timeline = summarizeSubtitleTimeline(subtitleEvents);
    console.info(`[render:${jobId}] subtitle_timeline first_start=${timeline.firstStart.toFixed(2)} last_end=${timeline.lastEnd.toFixed(2)} event_count=${timeline.count} scene_count=${imagePaths.length}`);
    if (subtitleEvents.length <= imagePaths.length) {
      console.warn(`[render:${jobId}] subtitle_event_density_low event_count=${subtitleEvents.length} scene_count=${imagePaths.length} possible_per_scene_bug=true`);
    }
  }

  const ghRender = await renderVideoViaGitHubActions({
    jobId,
    audioPath,
    imagePaths,
    subtitleEvents,
    voiceoverMeta: {
      voiceId: meta?.voiceId || 'unknown',
      timingSource: meta?.timingSource || 'unknown',
      durationSec,
    },
  });

  if (!ghRender?.localOutput) {
    throw new Error(`[render:${jobId}] github actions renderer did not return local output path`);
  }

  console.info(`[render:${jobId}] github_actions_render=success output=${ghRender.outputPath || ghRender.localOutput} runUrl=${ghRender.runUrl || 'n/a'}`);
  return ghRender.localOutput;
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
