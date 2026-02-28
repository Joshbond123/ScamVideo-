import axios from 'axios';
import { readJson, writeJson, PATHS } from '../db';
import { FacebookPage } from '../../src/types';

export async function verifyTokenAndGetPages(token: string): Promise<FacebookPage[]> {
  try {
    const response = await axios.get(`https://graph.facebook.com/v19.0/me/accounts?access_token=${token}`);
    const pages = response.data.data.map((p: any) => ({
      id: p.id,
      name: p.name,
      accessToken: p.access_token,
      status: 'valid',
      lastChecked: new Date().toISOString()
    }));
    return pages;
  } catch (error: any) {
    console.error('FB Token Verification Error:', error.response?.data || error.message);
    throw new Error('Invalid Facebook Access Token');
  }
}

export async function postToFacebook(pageId: string, message: string, link?: string) {
  const pages = await readJson<FacebookPage[]>(PATHS.facebook.pages);
  const page = pages.find(p => p.id === pageId);
  if (!page) throw new Error('Page not found');

  const url = `https://graph.facebook.com/v19.0/${pageId}/feed`;
  const params: any = {
    message,
    access_token: page.accessToken
  };
  if (link) params.link = link;

  const response = await axios.post(url, params);
  return response.data;
}

export async function postVideoToFacebook(pageId: string, videoUrl: string, description: string) {
  const pages = await readJson<FacebookPage[]>(PATHS.facebook.pages);
  const page = pages.find(p => p.id === pageId);
  if (!page) throw new Error('Page not found');

  const url = `https://graph.facebook.com/v19.0/${pageId}/videos`;
  const response = await axios.post(url, {
    file_url: videoUrl,
    description,
    access_token: page.accessToken
  });
  return response.data;
}
