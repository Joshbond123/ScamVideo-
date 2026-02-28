import { readJson, updateJson, PATHS } from './db';
import { Schedule } from '../src/types';
import { discoverTopics, getUniqueTopic } from './services/topicService';
import { generateScript, generateVoiceover, generateImage, assembleVideo, uploadToCatbox, cleanupJobAssets, generatePostImageWithTitleOverlay, cleanupPostImageAsset } from './services/videoService';
import { postPhotoToFacebook, postVideoToFacebook } from './services/facebookService';

let nextJobTimeout: NodeJS.Timeout | null = null;
const MAX_TIMEOUT_MS = 2_147_483_647; // Node.js setTimeout max (~24.8 days)

export function requestSchedulerRefresh() {
  scheduleNext().catch((error) => {
    console.error('Failed to refresh scheduler:', error);
  });
}

export async function startScheduler() {
  console.log('Scheduler starting...');
  await scheduleNext();
}

async function scheduleNext() {
  if (nextJobTimeout) clearTimeout(nextJobTimeout);

  const videoSchedules = await readJson<Schedule[]>(PATHS.schedules.video);
  const postSchedules = await readJson<Schedule[]>(PATHS.schedules.post);
  const allSchedules = [...videoSchedules, ...postSchedules].filter(s => s.status === 'pending');

  if (allSchedules.length === 0) {
    console.log('No pending schedules.');
    return;
  }

  // Find the nearest job
  allSchedules.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const nearest = allSchedules[0];
  const now = Date.now();
  const runAt = new Date(nearest.scheduledAt).getTime();
  const delay = Math.max(0, runAt - now);

  console.log(`Next job scheduled in ${delay / 1000}s: ${nearest.id}`);

  const timeout = Math.min(delay, MAX_TIMEOUT_MS);
  nextJobTimeout = setTimeout(async () => {
    if (delay > MAX_TIMEOUT_MS) {
      await scheduleNext();
      return;
    }

    await runJob(nearest);
    await scheduleNext();
  }, timeout);
}

export async function runJob(schedule: Schedule) {
  console.log(`Running job: ${schedule.id} (${schedule.type})`);
  
  // Update status to running
  await setScheduleStatus(schedule.id, schedule.type, 'generating');

  try {
    const candidates = await discoverTopics(schedule.niche);
    const topic = await getUniqueTopic(schedule.niche, candidates);
    
    if (!topic) throw new Error('No unique topics found');

    if (schedule.type === 'video') {
      await runVideoPipeline(schedule, topic);
    } else {
      await runPostPipeline(schedule, topic);
    }

    // Success
    await setScheduleStatus(schedule.id, schedule.type, 'posted');
    
    // Handle recurrence
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
        createdAt: new Date().toISOString()
      };
      
      const path = schedule.type === 'video' ? PATHS.schedules.video : PATHS.schedules.post;
      await updateJson<Schedule[]>(path, (data) => [newSchedule, ...data]);
    }

  } catch (error: any) {
    console.error(`Job ${schedule.id} failed:`, error.message);
    await setScheduleStatus(schedule.id, schedule.type, 'failed');
    // Log error
    await updateJson(PATHS.logs, (logs: any) => [{
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toISOString(),
      type: schedule.type,
      status: 'error',
      message: `Job ${schedule.id} failed: ${error.message}`
    }, ...logs]);
  } finally {
    requestSchedulerRefresh();
  }
}

async function runVideoPipeline(schedule: Schedule, topic: string) {
  const jobId = schedule.id;
  const scriptData = await generateScript(schedule.niche, topic);
  if (!Array.isArray(scriptData.scenes) || scriptData.scenes.length === 0) {
    throw new Error('Generated video script has no scenes');
  }

  const audioPath = await generateVoiceover(scriptData.script, jobId);

  const imagePaths: string[] = [];
  for (let i = 0; i < scriptData.scenes.length; i++) {
    const imgPath = await generateImage(scriptData.scenes[i].imagePrompt, jobId, i);
    imagePaths.push(imgPath);
  }

  const videoPath = await assembleVideo(jobId, audioPath, imagePaths);
  const videoUrl = await uploadToCatbox(videoPath);

  // Free-tier storage protection: remove temporary assets immediately after successful upload
  await cleanupJobAssets(jobId);

  const fbResult = await postVideoToFacebook(schedule.pageId, videoUrl, `${scriptData.caption}\n\n${scriptData.hashtags}`);
  
  // Save to published
  await updateJson(PATHS.content.published_videos, (data: any) => [{
    id: jobId,
    type: 'video',
    title: scriptData.title,
    niche: schedule.niche,
    postedAt: new Date().toISOString(),
    status: 'published',
    facebookUrl: `https://facebook.com/${fbResult.id}`,
    caption: scriptData.caption,
    hashtags: scriptData.hashtags
  }, ...data]);
}

async function runPostPipeline(schedule: Schedule, topic: string) {
  const scriptData = await generateScript(schedule.niche, topic);
  if (!Array.isArray(scriptData.scenes) || scriptData.scenes.length === 0) {
    throw new Error('Generated post script has no scenes');
  }

  const imgPath = await generatePostImageWithTitleOverlay(scriptData.scenes[0].imagePrompt, scriptData.title, schedule.id);
  
  // Upload post image and publish as a Facebook photo post so the overlayed title appears in-feed.

  const imageUrl = await uploadToCatbox(imgPath);
  await cleanupPostImageAsset(imgPath);
  const fbResult = await postPhotoToFacebook(schedule.pageId, imageUrl, `${scriptData.caption}\n\n${scriptData.hashtags}`);

  await updateJson(PATHS.content.published_posts, (data: any) => [{
    id: schedule.id,
    type: 'post',
    title: scriptData.title,
    niche: schedule.niche,
    postedAt: new Date().toISOString(),
    status: 'published',
    facebookUrl: `https://facebook.com/${fbResult.id}`,
    thumbnail: imageUrl,
    caption: scriptData.caption,
    hashtags: scriptData.hashtags
  }, ...data]);
}

async function setScheduleStatus(id: string, type: 'video' | 'post', status: any) {
  const path = type === 'video' ? PATHS.schedules.video : PATHS.schedules.post;
  await updateJson<Schedule[]>(path, (data) => {
    const idx = data.findIndex(s => s.id === id);
    if (idx !== -1) data[idx].status = status;
    return data;
  });
}
