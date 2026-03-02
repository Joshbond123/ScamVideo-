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

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function stripTrailingSource(title: string): string {
  return title.replace(/\s[-|–—]\s[^-|–—]{1,60}$/g, '').trim();
}

function extractRssTitles(xml: string): string[] {
  const titles: string[] = [];
  const regex = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/gis;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(xml)) !== null) {
    const raw = (match[1] || match[2] || '').trim();
    if (!raw) continue;
    if (/^rss$/i.test(raw) || /^google news$/i.test(raw) || /^bing news$/i.test(raw)) continue;
    titles.push(stripTrailingSource(decodeHtmlEntities(raw)));
  }

  return titles;
}

async function fetchRssTitles(url: string): Promise<string[]> {
  const response = await axios.get(url, {
    timeout: 20_000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ScamVideoBot/1.0)',
      Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    },
  });

  return extractRssTitles(String(response.data || ''));
}

export async function discoverTopics(niche: string): Promise<{ topics: string[]; source: string }> {
  const queries = NICHE_QUERIES[niche] || [];
  const titles: string[] = [];

  for (const query of queries) {
    const encoded = encodeURIComponent(query);
    const feeds = [
      `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`,
      `https://www.bing.com/news/search?q=${encoded}&format=rss`,
    ];

    for (const feedUrl of feeds) {
      try {
        const feedTitles = await fetchRssTitles(feedUrl);
        titles.push(...feedTitles);
      } catch (error: any) {
        console.warn('Free web topic fetch failed:', feedUrl, error?.response?.status || error?.message || error);
      }
    }
  }

  const topics = dedupeTopics(titles).slice(0, 50);
  return { topics, source: 'free-web-rss' };
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
