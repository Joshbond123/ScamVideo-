import axios, { AxiosRequestConfig } from 'axios';
import FormData from 'form-data';
import { readJson, PATHS } from '../db';
import { FacebookPage } from '../../src/types';

const FB_TIMEOUT_MS = 45_000;
const FB_RETRY_LIMIT = 3;

function toFacebookPage(page: { id: string; name: string; accessToken: string }): FacebookPage {
  return {
    id: page.id,
    name: page.name,
    accessToken: page.accessToken,
    status: 'valid',
    lastChecked: new Date().toISOString(),
  };
}

function isRetriable(error: any) {
  const status = error?.response?.status;
  return !status || status >= 500 || status === 429 || error?.code === 'ECONNABORTED';
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= FB_RETRY_LIMIT; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= FB_RETRY_LIMIT || !isRetriable(error)) break;
      const backoffMs = 500 * 2 ** (attempt - 1);
      console.warn(`[facebook:${label}] attempt ${attempt} failed; retrying in ${backoffMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw lastError;
}

async function fbPost(url: string, data: any, config: AxiosRequestConfig = {}) {
  return await withRetry('post', async () =>
    axios.post(url, data, {
      timeout: FB_TIMEOUT_MS,
      ...config,
    })
  );
}

async function fbGet(url: string, config: AxiosRequestConfig = {}) {
  return await withRetry('get', async () =>
    axios.get(url, {
      timeout: FB_TIMEOUT_MS,
      ...config,
    })
  );
}

async function getPageOrThrow(pageId: string): Promise<FacebookPage> {
  const pages = await readJson<FacebookPage[]>(PATHS.facebook.pages);
  const page = pages.find((p) => p.id === pageId);
  if (!page) throw new Error('Page not found');
  if (!page.accessToken) throw new Error(`Page access token missing for page ${pageId}`);
  return page;
}

export async function verifyTokenAndGetPages(token: string): Promise<FacebookPage[]> {
  try {
    const response = await fbGet('https://graph.facebook.com/v19.0/me/accounts', {
      params: { access_token: token },
    });

    const pages = (response.data?.data || []).map((p: any) =>
      toFacebookPage({
        id: p.id,
        name: p.name,
        accessToken: p.access_token || token,
      })
    );

    if (pages.length > 0) return pages;
  } catch (error: any) {
    console.warn('User token page fetch failed, trying page-token fallback:', error.response?.data || error.message);
  }

  try {
    const me = await fbGet('https://graph.facebook.com/v19.0/me', {
      params: {
        fields: 'id,name,category',
        access_token: token,
      },
    });

    if (me.data?.id && me.data?.name && me.data?.category) {
      return [
        toFacebookPage({
          id: me.data.id,
          name: me.data.name,
          accessToken: token,
        }),
      ];
    }
  } catch (error: any) {
    console.error('FB Token Verification Error:', error.response?.data || error.message);
  }

  throw new Error('Invalid Facebook token or token lacks page access permissions.');
}

export async function postToFacebook(pageId: string, message: string, link?: string) {
  const page = await getPageOrThrow(pageId);

  const url = `https://graph.facebook.com/v19.0/${pageId}/feed`;
  const params: any = {
    message,
    access_token: page.accessToken,
  };
  if (link) params.link = link;

  const response = await fbPost(url, params);
  return response.data;
}

export async function postPhotoToFacebook(pageId: string, imageUrl: string, caption: string) {
  const page = await getPageOrThrow(pageId);

  const url = `https://graph.facebook.com/v19.0/${pageId}/photos`;
  const response = await fbPost(url, {
    url: imageUrl,
    caption,
    access_token: page.accessToken,
  });
  return response.data;
}

export async function postVideoToFacebook(pageId: string, videoUrl: string, description: string) {
  const page = await getPageOrThrow(pageId);

  const url = `https://graph.facebook.com/v19.0/${pageId}/videos`;
  const download = await axios.get(videoUrl, {
    responseType: 'arraybuffer',
    timeout: 180_000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  const form = new FormData();
  form.append('description', description);
  form.append('published', 'true');
  form.append('access_token', page.accessToken);
  form.append('source', Buffer.from(download.data), {
    filename: 'video.mp4',
    contentType: 'video/mp4',
  });

  const response = await fbPost(url, form, {
    headers: form.getHeaders(),
    timeout: 300_000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  return response.data;
}

type FacebookPublishCheck = {
  id: string;
  url: string;
  postId?: string;
  published?: boolean;
  status?: string;
};

export async function postCommentToFacebook(pageId: string, postIdOrIds: string | string[], message: string) {
  const page = await getPageOrThrow(pageId);

  const rawIds = Array.isArray(postIdOrIds) ? postIdOrIds : [postIdOrIds];
  const candidateIds = Array.from(
    new Set(
      rawIds
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .flatMap((id) => (id.includes('_') ? [id, id.split('_')[1]] : [id, `${pageId}_${id}`]))
        .filter(Boolean)
    )
  );
  let lastError: any;

  for (const idForComment of candidateIds) {
    try {
      const url = `https://graph.facebook.com/v19.0/${idForComment}/comments`;
      const response = await fbPost(url, {
        message,
        access_token: page.accessToken,
      });
      return response.data;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to post Facebook comment');
}




async function fetchRecentPageVideos(pageId: string, accessToken: string, limit = 25) {
  const response = await fbGet(`https://graph.facebook.com/v19.0/${pageId}/videos`, {
    params: {
      fields: 'id,permalink_url,published,status,description,created_time',
      limit,
      access_token: accessToken,
    },
  });
  return Array.isArray(response?.data?.data) ? response.data.data : [];
}

async function fetchPageVideoState(pageId: string, accessToken: string, videoId: string) {
  try {
    const response = await fbGet(`https://graph.facebook.com/v19.0/${pageId}/videos`, {
      params: {
        fields: 'id,permalink_url,published,status',
        limit: 25,
        access_token: accessToken,
      },
    });

    const videos = Array.isArray(response?.data?.data) ? response.data.data : [];
    const match = videos.find((v: any) => String(v?.id || '') === String(videoId));
    if (!match) return null;

    const url = String(match?.permalink_url || '').trim();
    const status = String(match?.status?.video_status || '').trim();
    const publishStatus = String(match?.status?.publishing_phase?.publish_status || '').trim();
    const processing = String(match?.status?.processing_phase?.status || '').trim();
    const uploading = String(match?.status?.uploading_phase?.status || '').trim();

    return {
      id: String(match?.id || ''),
      url,
      published: Boolean(match?.published),
      status,
      publishStatus,
      processing,
      uploading,
    };
  } catch {
    return null;
  }
}

export async function verifyFacebookObjectPublished(pageId: string, objectId: string) {
  const page = await getPageOrThrow(pageId);
  const candidates = objectId.includes('_') ? [objectId, objectId.split('_')[1]] : [objectId, `${pageId}_${objectId}`];
  let lastError: any;

  for (const candidate of candidates.filter(Boolean)) {
    try {
      const response = await fbGet(`https://graph.facebook.com/v19.0/${candidate}`, {
        params: {
          fields: 'id,permalink_url',
          access_token: page.accessToken,
        },
      });

      if (response?.data?.id) {
        return {
          id: String(response.data.id),
          url: String(response.data.permalink_url || `https://facebook.com/${response.data.id}`),
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unable to verify Facebook publish object');
}

export async function verifyFacebookVideoPublished(pageId: string, objectId: string, expectedDescription?: string): Promise<FacebookPublishCheck> {
  const page = await getPageOrThrow(pageId);
  const candidates = objectId.includes('_') ? [objectId, objectId.split('_')[1]] : [objectId, `${pageId}_${objectId}`];
  const normalizedTargetIds = new Set(
    candidates
      .filter(Boolean)
      .map((value) => String(value).trim())
      .flatMap((value) => (value.includes('_') ? [value, value.split('_')[1]] : [value, `${pageId}_${value}`]))
      .filter(Boolean)
  );
  const timeoutMs = 180_000;
  const pollMs = 5_000;
  const startedAt = Date.now();
  let lastError: any;
  let lastObservedState = `no_facebook_state_observed expectedDescriptionHash=${Buffer.from(String(expectedDescription || '').slice(0, 120)).toString('base64')}`;

  while (Date.now() - startedAt < timeoutMs) {
    for (const candidate of candidates.filter(Boolean)) {
      try {
        const response = await fbGet(`https://graph.facebook.com/v19.0/${candidate}`, {
          params: {
            fields: 'id,permalink_url,post_id,published,status',
            access_token: page.accessToken,
          },
        });

        const id = String(response?.data?.id || '').trim();
        if (!id) continue;
        const url = String(response?.data?.permalink_url || '').trim();
        const postId = String(response?.data?.post_id || '').trim();
        const published = typeof response?.data?.published === 'boolean' ? response.data.published : undefined;
        const videoStatus = String(response?.data?.status?.video_status || '').trim();
        const publishPhaseStatus = String(response?.data?.status?.publishing_phase?.status || '').trim();
        const publishStatus = String(response?.data?.status?.publishing_phase?.publish_status || '').trim();
        const uploadPhaseStatus = String(response?.data?.status?.uploading_phase?.status || '').trim();
        const processingPhaseStatus = String(response?.data?.status?.processing_phase?.status || '').trim();

        lastObservedState = JSON.stringify({
          candidate,
          id,
          postId,
          published,
          videoStatus,
          publishPhaseStatus,
          publishStatus,
          uploadPhaseStatus,
          processingPhaseStatus,
          permalink: url,
        });

        const objectStateReady =
          videoStatus.toLowerCase() === 'ready' &&
          publishPhaseStatus.toLowerCase() === 'complete' &&
          publishStatus.toLowerCase() === 'published' &&
          uploadPhaseStatus.toLowerCase() === 'complete' &&
          processingPhaseStatus.toLowerCase() === 'complete';

        const normalizedUrl = url
          ? (/^https?:\/\//i.test(url) ? url : `https://www.facebook.com${url.startsWith('/') ? '' : '/'}${url}`)
          : '';
        const hasPublicLink = /^https?:\/\//i.test(normalizedUrl) && (normalizedUrl.includes('facebook.com') || normalizedUrl.includes('fb.watch') || normalizedUrl.includes('/reel/'));

        if (objectStateReady && (hasPublicLink || postId)) {
          return {
            id,
            url: normalizedUrl || `https://www.facebook.com/${postId || id}`,
            postId: postId || undefined,
            published,
            status: videoStatus || publishStatus || publishPhaseStatus || 'unknown',
          };
        }

        const pageState = await fetchPageVideoState(pageId, page.accessToken, id);
        const pageStateReady =
          !!pageState &&
          pageState.status.toLowerCase() === 'ready' &&
          pageState.publishStatus.toLowerCase() === 'published' &&
          pageState.processing.toLowerCase() === 'complete' &&
          pageState.uploading.toLowerCase() === 'complete' &&
          pageState.published === true;

        if (pageStateReady) {
          const pageUrl = pageState?.url
            ? (/^https?:\/\//i.test(pageState.url) ? pageState.url : `https://www.facebook.com${pageState.url.startsWith('/') ? '' : '/'}${pageState.url}`)
            : `https://www.facebook.com/${postId || id}`;

          return {
            id,
            url: pageUrl,
            postId: postId || undefined,
            published: true,
            status: 'ready',
          };
        }
      } catch (error) {
        lastError = error;
      }
    }

    try {
      const recent = await fetchRecentPageVideos(pageId, page.accessToken, 25);
      const nowMs = Date.now();
      const candidate = recent.find((video: any) => {
        const vid = String(video?.id || '').trim();
        const createdMs = new Date(video?.created_time || 0).getTime();
        const withinWindow = Number.isFinite(createdMs) ? Math.abs(nowMs - createdMs) <= 30 * 60 * 1000 : true;
        const status = String(video?.status?.video_status || '').toLowerCase();
        const publishStatus = String(video?.status?.publishing_phase?.publish_status || '').toLowerCase();
        const processing = String(video?.status?.processing_phase?.status || '').toLowerCase();
        const uploading = String(video?.status?.uploading_phase?.status || '').toLowerCase();
        return (
          vid &&
          normalizedTargetIds.has(vid) &&
          withinWindow &&
          status === 'ready' &&
          publishStatus === 'published' &&
          processing === 'complete' &&
          uploading === 'complete' &&
          video?.published === true
        );
      });

      if (candidate?.id) {
        const candidateUrl = String(candidate?.permalink_url || '').trim();
        const normalizedUrl = candidateUrl
          ? (/^https?:\/\//i.test(candidateUrl) ? candidateUrl : `https://www.facebook.com${candidateUrl.startsWith('/') ? '' : '/'}${candidateUrl}`)
          : `https://www.facebook.com/${candidate.id}`;

        return {
          id: String(candidate.id),
          url: normalizedUrl,
          published: true,
          status: 'ready',
        };
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError || 'unknown error');
  throw new Error(`Facebook video publish verification timed out for ${objectId}. ${message}. lastObservedState=${lastObservedState}`);
}
