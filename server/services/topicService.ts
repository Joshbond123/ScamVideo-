import Parser from 'rss-parser';
import { appendJson, PATHS, readJson } from '../db';
import stringSimilarity from 'string-similarity';

const parser = new Parser();

const BASE_SOURCES = {
  'Romance & Pig-Butchering Crypto Scams': [
    'https://www.fbi.gov/rss/news',
    'https://www.consumer.ftc.gov/blog/rss',
    'https://krebsonsecurity.com/feed/',
    'https://www.ic3.gov/Media/News/rss',
    'https://www.chainalysis.com/blog/rss/',
  ],
  'AI-Driven & Deepfake Crypto Scams': [
    'https://techcrunch.com/tag/deepfake/feed/',
    'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
    'https://www.bleepingcomputer.com/feed/',
    'https://www.wired.com/feed/tag/ai/latest/rss',
    'https://www.darkreading.com/rss.xml',
  ],
  'Crypto Scam Statistics & Big Numbers': [
    'https://cointelegraph.com/rss/tag/scam',
    'https://www.coindesk.com/arc/outboundfeeds/rss/',
    'https://www.chainalysis.com/blog/rss/',
    'https://feeds.feedburner.com/TheHackersNews',
    'https://www.cisa.gov/news.xml',
  ],
};

const GOOGLE_NEWS_QUERIES: Record<string, string[]> = {
  'Romance & Pig-Butchering Crypto Scams': [
    'pig butchering crypto scam',
    'romance crypto fraud',
    'whatsapp investment scam',
    'telegram crypto romance scam',
    'southeast asia scam compounds',
    'crypto dating scam arrests',
    'money mule crypto scam',
    'fbi pig butchering warning',
    'online romance fraud crypto',
    'investment confidence scam crypto',
  ],
  'AI-Driven & Deepfake Crypto Scams': [
    'deepfake crypto scam',
    'ai voice clone fraud crypto',
    'deepfake celebrity crypto ad scam',
    'synthetic identity crypto fraud',
    'ai phishing crypto wallet',
    'genai impersonation scam',
    'deepfake video investment scam',
    'voice cloning scam losses',
    'ai social engineering crypto',
    'deepfake exchange scam',
  ],
  'Crypto Scam Statistics & Big Numbers': [
    'crypto scam losses report',
    'crypto fraud statistics',
    'blockchain scam annual report',
    'federal crypto crime statistics',
    'global crypto hacks losses',
    'romance scam losses 2024 crypto',
    'investment scam losses report',
    'pig butchering losses statistics',
    'fraud trend report cryptocurrency',
    'chainalysis crypto crime report',
  ],
};

function buildGoogleNewsRssUrls(niche: string) {
  const queries = GOOGLE_NEWS_QUERIES[niche] || [];
  return queries.map((q) =>
    `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`
  );
}

export async function discoverTopics(niche: string): Promise<string[]> {
  const feeds = [...(BASE_SOURCES[niche as keyof typeof BASE_SOURCES] || []), ...buildGoogleNewsRssUrls(niche)];
  const topics: string[] = [];

  await Promise.all(
    feeds.map(async (url) => {
      try {
        const feed = await parser.parseURL(url);
        const recent = (feed.items || [])
          .slice(0, 8)
          .map((item) => item.title || '')
          .filter(Boolean);
        topics.push(...recent);
      } catch (error) {
        console.error(`Error fetching feed ${url}:`, error);
      }
    })
  );

  const deduped = Array.from(new Set(topics.map((t) => t.trim()))).filter((t) => t.length > 12);
  return deduped.slice(0, 50);
}

export async function getUniqueTopic(niche: string, candidates: string[]): Promise<string | null> {
  const history = await readJson<string[]>(PATHS.topics.history);
  const normalizedHistory = history.map((topic) => topic.toLowerCase());

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
