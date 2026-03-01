import axios from 'axios';
import { appendJson, PATHS, readJson } from '../db';
import stringSimilarity from 'string-similarity';

const NICHE_QUERIES: Record<string, string[]> = {
  'Romance & Pig-Butchering Crypto Scams': [
    'pig butchering crypto scam latest',
    'romance crypto scam arrests',
    'investment whatsapp scam crypto',
    'telegram romance crypto fraud',
    'crypto money mule romance fraud',
    'pig butchering task scam victims',
    'crypto romance scam headlines',
  ],
  'AI-Driven & Deepfake Crypto Scams': [
    'deepfake crypto scam latest',
    'ai voice cloning crypto fraud',
    'deepfake celebrity crypto ad scam',
    'synthetic identity scam crypto',
    'ai phishing wallet theft scam',
    'ai impersonation investment scam',
    'deepfake finance fraud today',
  ],
  'Crypto Scam Statistics & Big Numbers': [
    'crypto scam losses statistics',
    'crypto fraud annual report',
    'chainalysis crypto crime report scam',
    'crypto hacks losses billions',
    'federal crypto fraud numbers',
    'crypto investment scam totals',
    'global crypto fraud trends',
  ],
};

function dedupeTopics(topics: string[]) {
  return Array.from(new Set(topics.map((t) => t.trim()))).filter((t) => t.length > 12);
}

function getSerpstackKey(settings: any) {
  const fromSettings = typeof settings?.serpstackApiKey === 'string' ? settings.serpstackApiKey.trim() : '';
  return process.env.SERPSTACK_API_KEY || fromSettings;
}

export async function discoverTopics(niche: string): Promise<{ topics: string[]; source: string }> {
  const settings = await readJson<any>(PATHS.settings);
  const accessKey = getSerpstackKey(settings);
  if (!accessKey) {
    throw new Error('Serpstack API key missing in settings.serpstackApiKey or SERPSTACK_API_KEY');
  }

  const queries = NICHE_QUERIES[niche] || [];
  const titles: string[] = [];

  for (const query of queries) {
    try {
      const response = await axios.get('https://api.serpstack.com/search', {
        params: {
          access_key: accessKey,
          query,
          type: 'news',
          num: 15,
          gl: 'us',
          hl: 'en',
        },
        timeout: 20_000,
      });

      const payload = response.data || {};
      const items = [
        ...(Array.isArray(payload.news_results) ? payload.news_results : []),
        ...(Array.isArray(payload.news) ? payload.news : []),
        ...(Array.isArray(payload.organic_results) ? payload.organic_results : []),
      ];

      for (const item of items) {
        const title = typeof item?.title === 'string' ? item.title.trim() : '';
        if (title) titles.push(title);
      }
    } catch (error: any) {
      console.warn('Serpstack topic fetch failed for query:', query, error?.response?.data || error?.message || error);
    }
  }

  const topics = dedupeTopics(titles).slice(0, 50);
  return { topics, source: 'serpstack' };
}

export async function getUniqueTopic(niche: string, candidates: string[]): Promise<string | null> {
  const history = await readJson<string[]>(PATHS.topics.history);

  const normalizedHistory = history
    .map((entry) => {
      const parts = entry.split('::');
      return (parts[parts.length - 1] || entry).trim().toLowerCase();
    })
    .filter(Boolean);

  for (const candidate of candidates) {
    const normalizedCandidate = candidate.toLowerCase();

    const hasNearDuplicate = normalizedHistory.some((pastTopic) => {
      const similarity = stringSimilarity.compareTwoStrings(normalizedCandidate, pastTopic);
      return similarity > 0.7;
    });

    if (!hasNearDuplicate) {
      await appendJson(PATHS.topics.history, `${niche} :: ${candidate}`);
      return candidate;
    }
  }

  return null;
}
