export type Niche = 'Romance & Pig-Butchering Crypto Scams' | 'AI-Driven & Deepfake Crypto Scams' | 'Crypto Scam Statistics & Big Numbers';

export type Status = 'pending' | 'generating' | 'posted' | 'failed';

export interface Schedule {
  id: string;
  type: 'video' | 'post';
  niche: Niche;
  pageId: string;
  scheduledAt: string;
  isDaily: boolean;
  status: Status;
  createdAt: string;
  startedAt?: string;
  publishedAt?: string;
  failedAt?: string;
  errorMessage?: string;
  lastTopic?: string;
  generatedTitle?: string;
  pageName?: string;
}

export interface PublishedItem {
  id: string;
  type: 'video' | 'post';
  title: string;
  niche: Niche;
  postedAt: string;
  status: 'published';
  thumbnail?: string;
  caption: string;
  hashtags: string;
  facebookUrl: string;
}

export interface ApiKey {
  id: string;
  provider: 'cerebras' | 'unrealspeech' | 'workers-ai';
  name: string;
  key: string;
  lastUsed?: string;
  successCount: number;
  failCount: number;
  status: 'active' | 'inactive';
}

export interface FacebookPage {
  id: string;
  name: string;
  accessToken: string;
  status: 'valid' | 'expired';
  lastChecked: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'video' | 'post' | 'system';
  niche?: Niche;
  status: 'success' | 'error' | 'info';
  message: string;
}

export interface DashboardStats {
  connectedPages: number;
  scheduledVideos: number;
  scheduledPosts: number;
  publishedThisWeek: number;
}
