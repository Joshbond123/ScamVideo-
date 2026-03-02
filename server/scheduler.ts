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
  rewriteTopicForVideo,
} from './services/videoService';
import { postCommentToFacebook, postPhotoToFacebook, postVideoToFacebook } from './services/facebookService';
import { getActiveKeys, resolveCloudflareAccountId } from './services/keyService';

const SCHEDULER_TICK_MS = 15_000;
let schedulerInterval: NodeJS.Timeout | null = null;
let isTickRunning = false;

function getScheduleSortTime(schedule: Schedule) {
  const primary = schedule.createdAt || schedule.scheduledAt;
  const t = new Date(primary).getTime();
  return Number.isFinite(t) ? t : 0;
}

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
      id: Math.random().toString(36).slice(2, 11),
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

  if (!settings?.catboxHash) missing.push('catboxHash');

  const cloudflareAccountId = await resolveCloudflareAccountId();
  if (!cloudflareAccountId) missing.push('cloudflare_account_id');

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

async function claimScheduleForRun(id: string, type: 'video' | 'post'): Promise<boolean> {
  const path = type === 'video' ? PATHS.schedules.video : PATHS.schedules.post;
  let claimed = false;

  await updateJson<Schedule[]>(path, (data) => {
    const list = Array.isArray(data) ? data : [];
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) return list;

    if (list[idx].status !== 'pending') return list;

    list[idx] = {
      ...list[idx],
      status: 'generating',
      startedAt: new Date().toISOString(),
      errorMessage: '',
    };
    claimed = true;
    return list;
  });

  return claimed;
}

async function processDueSchedules() {
  if (isTickRunning) return;
  isTickRunning = true;

  try {
    const videoSchedules = await readJson<Schedule[]>(PATHS.schedules.video);
    const postSchedules = await readJson<Schedule[]>(PATHS.schedules.post);
    const pending = [...videoSchedules, ...postSchedules]
      .filter((s) => s.status === 'pending')
      .sort((a, b) => getScheduleSortTime(a) - getScheduleSortTime(b));

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
  const claimed = await claimScheduleForRun(schedule.id, schedule.type);
  if (!claimed) {
    await logEvent(schedule.type, 'info', `job_skip_non_pending id=${schedule.id} status_changed_before_start`, schedule.niche);
    return;
  }

  await logEvent(schedule.type, 'info', `job_start id=${schedule.id} scheduledAt=${schedule.scheduledAt}`, schedule.niche);

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

    const selectedTopic = schedule.type === 'video' ? await withStage(schedule, 'topic_rewrite', async () => rewriteTopicForVideo(schedule.niche, topic)) : topic;

    await logEvent(schedule.type, 'info', `selected_topic=${selectedTopic}`, schedule.niche);
    await updateSchedule(schedule.id, schedule.type, { lastTopic: selectedTopic });

    if (schedule.type === 'video') {
      await runVideoPipeline(schedule, selectedTopic);
    } else {
      await runPostPipeline(schedule, selectedTopic);
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
        id: Math.random().toString(36).slice(2, 11),
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
  await updateSchedule(schedule.id, schedule.type, { generatedTitle: scriptData?.title || '' });

  if (!Array.isArray(scriptData?.scenes) || scriptData.scenes.length === 0) {
    throw new Error('Generated video script has no scenes');
  }

  const stitchedScript = [scriptData.hook, scriptData.script, scriptData.preCtaScene?.text, scriptData.cta].filter(Boolean).join(' ');
  const audioPath = await withStage(schedule, 'video_voiceover_generation', async () => generateVoiceover(stitchedScript, jobId));

  const scenePlan = [...scriptData.scenes, scriptData.preCtaScene, { text: scriptData.cta, imagePrompt: `Topic-aware call to action visual for ${topic}, dynamic social media ending frame, no text, no logo, vertical 9:16` }].filter(Boolean);
  const imagePaths: string[] = [];
  await withStage(schedule, 'video_scene_image_generation', async () => {
    for (let i = 0; i < scenePlan.length; i++) {
      const prompt = `${scenePlan[i].imagePrompt}. Vertical 9:16 composition. No text, words, watermarks, logos.`;
      const imgPath = await generateImage(prompt, jobId, i);
      imagePaths.push(imgPath);
    }
  });

  const videoPath = await withStage(schedule, 'video_render_ffmpeg', async () =>
    assembleVideo(
      jobId,
      audioPath,
      imagePaths,
      scenePlan.map((s: any) => String(s?.text || '').trim()).filter(Boolean)
    )
  );

  const videoUrl = await withStage(schedule, 'video_host_catbox', async () => uploadToCatbox(videoPath));

  await withStage(schedule, 'video_publish_facebook', async () => {
    const description = `${scriptData.caption}\n\n${scriptData.hashtags}`;
    const fbResult = await postVideoToFacebook(schedule.pageId, videoUrl, description);
    const publishTargetId = String((fbResult as any)?.post_id || (fbResult as any)?.id || '');

    const settings = await readJson<any>(PATHS.settings);
    const comment = await generateFacebookComment(scriptData.title, scriptData.caption, topic, settings?.facebookCommentUrl || '');

    if (publishTargetId) {
      try {
        await postCommentToFacebook(schedule.pageId, publishTargetId, comment);
      } catch (error: any) {
        await logEvent(schedule.type, 'error', `comment_publish_failed id=${schedule.id} message=${error?.message || error}`, schedule.niche);
      }
    }

    await updateJson(PATHS.content.published_videos, (data: any[]) => [
      {
        id: jobId,
        type: 'video',
        title: scriptData.title,
        niche: schedule.niche,
        postedAt: new Date().toISOString(),
        status: 'published',
        facebookUrl: publishTargetId ? `https://facebook.com/${publishTargetId}` : '',
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
  await updateSchedule(schedule.id, schedule.type, { generatedTitle: scriptData?.title || '' });

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
