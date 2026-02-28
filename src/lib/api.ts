import axios from 'axios';
import {
  DashboardStats,
  Schedule,
  PublishedItem,
  ApiKey,
  FacebookPage,
  LogEntry,
} from '../types';

const client = axios.create({
  baseURL: '/api'
});

export const api = {
  getDashboard: async (): Promise<DashboardStats> => {
    const [pages, videos, posts, publishedV, publishedP] = await Promise.all([
      client.get('/facebook/pages'),
      client.get('/schedules/video'),
      client.get('/schedules/post'),
      client.get('/content/published-videos'),
      client.get('/content/published-posts')
    ]);

    return {
      connectedPages: pages.data.length,
      scheduledVideos: videos.data.filter((s: any) => s.status === 'pending').length,
      scheduledPosts: posts.data.filter((s: any) => s.status === 'pending').length,
      publishedThisWeek: publishedV.data.length + publishedP.data.length
    };
  },

  getSchedules: async (type?: 'video' | 'post'): Promise<Schedule[]> => {
    if (type) {
      const res = await client.get(`/schedules/${type}`);
      return res.data;
    }
    const [v, p] = await Promise.all([
      client.get('/schedules/video'),
      client.get('/schedules/post')
    ]);
    return [...v.data, ...p.data];
  },

  createSchedule: async (payload: Omit<Schedule, 'id' | 'createdAt' | 'status'>): Promise<Schedule> => {
    const res = await client.post(`/schedules/${payload.type}`, payload);
    return res.data;
  },

  deleteSchedule: async (id: string, type: 'video' | 'post'): Promise<void> => {
    await client.delete(`/schedules/${type}/${id}`);
  },

  getPublished: async (): Promise<PublishedItem[]> => {
    const [v, p] = await Promise.all([
      client.get('/content/published-videos'),
      client.get('/content/published-posts')
    ]);
    return [...v.data, ...p.data];
  },

  getKeys: async (provider: ApiKey['provider']): Promise<ApiKey[]> => {
    const res = await client.get(`/keys/${provider}`);
    return res.data;
  },

  addKey: async (provider: ApiKey['provider'], name: string, key: string): Promise<ApiKey> => {
    const res = await client.post(`/keys/${provider}`, { name, key });
    return res.data;
  },

  updateKey: async (provider: ApiKey['provider'], id: string, payload: Partial<Pick<ApiKey, 'name' | 'key' | 'status'>>): Promise<ApiKey> => {
    const res = await client.put(`/keys/${provider}/${id}`, payload);
    return res.data;
  },

  deleteKey: async (id: string, provider: ApiKey['provider']): Promise<void> => {
    await client.delete(`/keys/${provider}/${id}`);
  },

  connectFacebook: async (token: string): Promise<FacebookPage[]> => {
    const res = await client.post('/facebook/connect', { token });
    return res.data;
  },

  getFacebookPages: async (): Promise<FacebookPage[]> => {
    const res = await client.get('/facebook/pages');
    return res.data;
  },

  refreshFacebookPage: async (id: string): Promise<FacebookPage> => {
    const res = await client.post(`/facebook/pages/${id}/refresh`);
    return res.data;
  },

  removeFacebookPage: async (id: string): Promise<void> => {
    await client.delete(`/facebook/pages/${id}`);
  },

  saveCatboxHash: async (hash: string): Promise<void> => {
    const settings = await client.get('/settings').then(r => r.data);
    await client.post('/settings', { ...settings, catboxHash: hash });
  },

  getCatboxHash: async (): Promise<string> => {
    const res = await client.get('/settings');
    return res.data.catboxHash || '';
  },

  getLogs: async (): Promise<LogEntry[]> => {
    const res = await client.get('/logs');
    return res.data;
  },

  runJobManual: async (id: string, type: 'video' | 'post'): Promise<void> => {
    await client.post(`/run/${type}/${id}`);
  }
};
