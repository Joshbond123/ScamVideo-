import axios from 'axios';
import { readJson, updateJson, PATHS } from './db';
import { Schedule, ApiKey } from '../src/types';
import { discoverTopics, getUniqueTopic } from './services/topicService';
import {
  generateScript,
  generateVoiceover,
  generateImage,
  assembleVideo,
  uploadToCatbox,
  cleanupJobAssets,
  generatePostImageWithTitleOverlay,
  cleanupPostImageAsset,
  generateFacebookComment,
} from './services/videoService';
import { postCommentToFacebook, postPhotoToFacebook, postVideoToFacebook } from './services/facebookService';
import { getActiveKeys } from './services/keyService';

const SCHEDULER_TICK_MS = 15_000;
let schedulerInterval: NodeJS.Timeout | null = null;
let isTickRunning = false;

function normalizeError(error: any) {
  if (axios.isAxiosError(error)) {
    return {
      message: error.message,
      status: error.response?.status,
      response: error.response?.data,
      code: error.code,
      url: error.config?.url,
    };
  }

  return {
    message: error instanceof Error ? error.message : String(error),
  };
}

async function logEvent(type: 'video' | 'post' | 'system', status: 'success' | 'error' | 'info', message: string, niche?: string) {
  const line = `[${new Date().toISOString()}] [${type}] [${status}] ${message}`;
  if (status === 'error') console.error(line);
  else console.log(line);

  await updateJson(PATHS.logs, (logs: any[]) => [
    {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      type,
      niche,
      status,
      message,
    },
    ...(Array.isArray(logs) ? logs : []),
  ]);
}

async function withStage<T>(schedule: Schedule, stage: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  await logEvent(schedule.type, 'info', `stage_start:${stage}`, schedule.niche);
  try {
    const out = await fn();
    const elapsed = Date.now() - started;
    await logEvent(schedule.type, 'success', `stage_end:${stage} (${elapsed}ms)`, schedule.niche);
    return out;
  } catch (error: any) {
    const elapsed = Date.now() - started;
    const e = normalizeError(error);
    await logEvent(
      schedule.type,
      'error',
      `stage_fail:${stage} (${elapsed}ms) message=${e.message}${e.status ? ` status=${e.status}` : ''}${e.response ? ` response=${JSON.stringify(e.response)}` : ''}`,
      schedule.niche
    );
    throw error;
  }
}

async function validateRequiredConfig(schedule: Schedule) {
  const settings = await readJson<any>(PATHS.settings);
  const pages = await readJson<any[]>(PATHS.facebook.pages);
  const page = pages.find((p) => p.id === schedule.pageId);

  const missing: string[] = [];

  const keyProviders: ApiKey['provider'][] = schedule.type === 'video' ? ['cerebras', 'unrealspeech', 'workers-ai'] : ['cerebras', 'workers-ai'];
  for (const provider of keyProviders) {
    const active = await getActiveKeys(provider);
    if (!active.length) missing.push(`api_key:${provider}`);
  }

  if (!page) missing.push('facebook_page:selected_page_not_found');
  if (page && !page.accessToken) missing.push('facebook_page_access_token');

  if (schedule.type === 'video') {
    if (!settings?.catboxHash) missing.push('catboxHash');
  } else {
    if (!settings?.catboxHash) missing.push('catboxHash');
  }

  if (!process.env.CLOUDFLARE_ACCOUNT_ID) {
    const workersKeys = await getActiveKeys('workers-ai');
    if (!workersKeys.some((k) => (k.name || '').trim().length > 0)) {
      missing.push('CLOUDFLARE_ACCOUNT_ID_or_workers_ai_key_label');
    }
  }

  if (missing.length) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }
}

async function updateSchedule(id: string, type: 'video' | 'post', patch: Partial<Schedule>) {
  const path = type === 'video' ? PATHS.schedules.video : PATHS.schedules.post;
  await updateJson<Schedule[]>(path, (data) => {
    const list = Array.isArray(data) ? data : [];
    const idx = list.findIndex((s) => s.id === id);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...patch };
    }
    return list;
  });
}

async function setScheduleStatus(id: string, type: 'video' | 'post', status: Schedule['status'], patch: Partial<Schedule> = {}) {
  await updateSchedule(id, type, { ...patch, status });
}

async function processDueSchedules() {
  if (isTickRunning) return;
  isTickRunning = true;

  try {
    const videoSchedules = await readJson<Schedule[]>(PATHS.schedules.video);
    const postSchedules = await readJson<Schedule[]>(PATHS.schedules.post);
    const pending = [...videoSchedules, ...postSchedules]
      .filter((s) => s.status === 'pending')
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

    if (!pending.length) {
      await logEvent('system', 'info', 'scheduler_tick:no_pending_schedules');
      return;
    }

    const now = Date.now();
    const due = pending.filter((s) => new Date(s.scheduledAt).getTime() <= now);

    if (!due.length) {
      const next = pending[0];
      const delaySec = Math.max(0, Math.round((new Date(next.scheduledAt).getTime() - now) / 1000));
      await logEvent('system', 'info', `scheduler_tick:next_job_in_${delaySec}s job=${next.id} type=${next.type}`);
      return;
    }

    for (const schedule of due) {
      await runJob(schedule);
    }
  } finally {
    isTickRunning = false;
  }
}

export function requestSchedulerRefresh() {
  processDueSchedules().catch((error) => {
    console.error('Failed to refresh scheduler:', error);
  });
}

export async function startScheduler() {
  console.log('Scheduler starting...');
  if (schedulerInterval) clearInterval(schedulerInterval);

  try {
    await processDueSchedules();
  } catch (error) {
    console.error('Scheduler initial tick failed:', error);
  }

  schedulerInterval = setInterval(() => {
    processDueSchedules().catch((error) => {
      console.error('Scheduler interval tick failed:', error);
    });
  }, SCHEDULER_TICK_MS);
}

export async function runJob(schedule: Schedule) {
  await logEvent(schedule.type, 'info', `job_start id=${schedule.id} scheduledAt=${schedule.scheduledAt}`, schedule.niche);
  await setScheduleStatus(schedule.id, schedule.type, 'generating', { startedAt: new Date().toISOString(), errorMessage: '' });

  try {
    await withStage(schedule, 'validate_required_config', async () => validateRequiredConfig(schedule));

    const topicDiscovery = await withStage(schedule, 'topic_discovery', async () => discoverTopics(schedule.niche));
    await logEvent(
      schedule.type,
      'info',
      `topic_discovery_result source=${topicDiscovery.source} count=${topicDiscovery.topics.length}`,
      schedule.niche
    );

    const topic = await withStage(schedule, 'topic_selection', async () => getUniqueTopic(schedule.niche, topicDiscovery.topics));
    if (!topic) throw new Error('No unique topics found');

    await logEvent(schedule.type, 'info', `selected_topic=${topic}`, schedule.niche);
    await updateSchedule(schedule.id, schedule.type, { lastTopic: topic });

    if (schedule.type === 'video') {
      await runVideoPipeline(schedule, topic);
    } else {
      await runPostPipeline(schedule, topic);
    }

    await setScheduleStatus(schedule.id, schedule.type, 'posted', { publishedAt: new Date().toISOString(), failedAt: undefined, errorMessage: '' });
    await logEvent(schedule.type, 'success', `job_success id=${schedule.id}`, schedule.niche);

    if (schedule.isDaily) {
      const nextDate = new Date(schedule.scheduledAt);
      const now = new Date();
      while (nextDate <= now) {
        nextDate.setDate(nextDate.getDate() + 1);
      }

      const newSchedule: Schedule = {
        ...schedule,
        id: Math.random().toString(36).substr(2, 9),
        scheduledAt: nextDate.toISOString(),
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      const path = schedule.type === 'video' ? PATHS.schedules.video : PATHS.schedules.post;
      await updateJson<Schedule[]>(path, (data) => [newSchedule, ...data]);
      await logEvent(schedule.type, 'info', `daily_rescheduled original=${schedule.id} next=${newSchedule.id} at=${newSchedule.scheduledAt}`, schedule.niche);
    }
  } catch (error: any) {
    const e = normalizeError(error);
    await setScheduleStatus(schedule.id, schedule.type, 'failed', { failedAt: new Date().toISOString(), errorMessage: e.message });
    await logEvent(
      schedule.type,
      'error',
      `job_failed id=${schedule.id} message=${e.message}${e.status ? ` status=${e.status}` : ''}${e.response ? ` response=${JSON.stringify(e.response)}` : ''}`,
      schedule.niche
    );
  }
}

async function runVideoPipeline(schedule: Schedule, topic: string) {
  const jobId = schedule.id;
  const scriptData = await withStage(schedule, 'video_script_generation', async () => generateScript(schedule.niche, topic));

  if (!Array.isArray(scriptData?.scenes) || scriptData.scenes.length === 0) {
    throw new Error('Generated video script has no scenes');
  }

  const audioPath = await withStage(schedule, 'video_voiceover_generation', async () => generateVoiceover(scriptData.script, jobId));

  const imagePaths: string[] = [];
  await withStage(schedule, 'video_scene_image_generation', async () => {
    for (let i = 0; i < scriptData.scenes.length; i++) {
      const prompt = `${scriptData.scenes[i].imagePrompt}. Vertical 9:16 composition. No text, words, watermarks, logos.`;
      const imgPath = await generateImage(prompt, jobId, i);
      imagePaths.push(imgPath);
    }
  });

  const videoPath = await withStage(schedule, 'video_render_ffmpeg', async () =>
    assembleVideo(
      jobId,
      audioPath,
      imagePaths,
      scriptData.scenes.map((s: any) => String(s?.text || '').trim()).filter(Boolean)
    )
  );

  const videoUrl = await withStage(schedule, 'video_host_catbox', async () => uploadToCatbox(videoPath));

  await withStage(schedule, 'video_publish_facebook', async () => {
    const description = `${scriptData.caption}\n\n${scriptData.hashtags}`;
    const fbResult = await postVideoToFacebook(schedule.pageId, videoUrl, description);

    const settings = await readJson<any>(PATHS.settings);
    const comment = await generateFacebookComment(scriptData.title, scriptData.caption, topic, settings?.facebookCommentUrl || '');
    await postCommentToFacebook(schedule.pageId, fbResult.id, comment);

    await updateSchedule(schedule.id, schedule.type, { generatedTitle: scriptData.title });

    await updateJson(PATHS.content.published_videos, (data: any[]) => [
      {
        id: jobId,
        type: 'video',
        title: scriptData.title,
        niche: schedule.niche,
        postedAt: new Date().toISOString(),
        status: 'published',
        facebookUrl: `https://facebook.com/${fbResult.id}`,
        caption: scriptData.caption,
        hashtags: scriptData.hashtags,
      },
      ...(Array.isArray(data) ? data : []),
    ]);
  });

  await withStage(schedule, 'video_cleanup_assets', async () => cleanupJobAssets(jobId));
}

async function runPostPipeline(schedule: Schedule, topic: string) {
  const scriptData = await withStage(schedule, 'post_script_generation', async () => generateScript(schedule.niche, topic));

  if (!Array.isArray(scriptData?.scenes) || scriptData.scenes.length === 0) {
    throw new Error('Generated post script has no scenes');
  }

  const imgPath = await withStage(schedule, 'post_image_generation_with_overlay', async () =>
    generatePostImageWithTitleOverlay(scriptData.scenes[0].imagePrompt, scriptData.title, schedule.id)
  );

  const imageUrl = await withStage(schedule, 'post_host_catbox', async () => uploadToCatbox(imgPath));
  await withStage(schedule, 'post_cleanup_local_asset', async () => cleanupPostImageAsset(imgPath));

  await withStage(schedule, 'post_publish_facebook', async () => {
    const fbResult = await postPhotoToFacebook(schedule.pageId, imageUrl, `${scriptData.caption}\n\n${scriptData.hashtags}`);

    await updateSchedule(schedule.id, schedule.type, { generatedTitle: scriptData.title });

    await updateJson(PATHS.content.published_posts, (data: any[]) => [
      {
        id: schedule.id,
        type: 'post',
        title: scriptData.title,
        niche: schedule.niche,
        postedAt: new Date().toISOString(),
        status: 'published',
        facebookUrl: `https://facebook.com/${fbResult.id}`,
        thumbnail: imageUrl,
        caption: scriptData.caption,
        hashtags: scriptData.hashtags,
      },
      ...(Array.isArray(data) ? data : []),
    ]);
  });
}
