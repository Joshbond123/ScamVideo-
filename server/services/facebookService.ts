import axios, { AxiosRequestConfig } from 'axios';
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
  const response = await fbPost(url, {
    file_url: videoUrl,
    description,
    access_token: page.accessToken,
  });
  return response.data;
}

export async function postCommentToFacebook(pageId: string, postId: string, message: string) {
  const page = await getPageOrThrow(pageId);

  const candidateIds = postId.includes('_') ? [postId, postId.split('_')[1]] : [postId, `${pageId}_${postId}`];
  let lastError: any;

  for (const idForComment of candidateIds.filter(Boolean)) {
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
