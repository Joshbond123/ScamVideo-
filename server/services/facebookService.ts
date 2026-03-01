import axios from 'axios';
import { readJson, PATHS } from '../db';
import { FacebookPage } from '../../src/types';

function toFacebookPage(page: { id: string; name: string; accessToken: string }): FacebookPage {
  return {
    id: page.id,
    name: page.name,
    accessToken: page.accessToken,
    status: 'valid',
    lastChecked: new Date().toISOString(),
  };
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
    const response = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
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
    const me = await axios.get('https://graph.facebook.com/v19.0/me', {
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

  const response = await axios.post(url, params);
  return response.data;
}

export async function postPhotoToFacebook(pageId: string, imageUrl: string, caption: string) {
  const page = await getPageOrThrow(pageId);

  const url = `https://graph.facebook.com/v19.0/${pageId}/photos`;
  const response = await axios.post(url, {
    url: imageUrl,
    caption,
    access_token: page.accessToken,
  });
  return response.data;
}

export async function postVideoToFacebook(pageId: string, videoUrl: string, description: string) {
  const page = await getPageOrThrow(pageId);

  const url = `https://graph.facebook.com/v19.0/${pageId}/videos`;
  const response = await axios.post(url, {
    file_url: videoUrl,
    description,
    access_token: page.accessToken,
  });
  return response.data;
}

export async function postCommentToFacebook(pageId: string, postId: string, message: string) {
  const page = await getPageOrThrow(pageId);
  const idForComment = postId.includes('_') ? postId : `${pageId}_${postId}`;

  const url = `https://graph.facebook.com/v19.0/${idForComment}/comments`;
  const response = await axios.post(url, {
    message,
    access_token: page.accessToken,
  });
  return response.data;
}
