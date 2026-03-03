import axios from 'axios';
import { appendJson, PATHS, readJson } from '../db';
import stringSimilarity from 'string-similarity';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'at', 'with', 'by', 'from', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'that', 'this', 'it', 'as', 'after', 'before', 'into', 'over', 'under', 'new', 'latest', 'today',
  'how', 'why', 'what', 'when', 'where', 'who', 'crypto', 'scam', 'scams'
]);

const HISTORY_LOOKBACK = 250;
const RECENT_SELECTION_TTL_MS = 1000 * 60 * 60 * 6;
const recentSelectionsByNiche = new Map<string, Array<{ topic: string; at: number }>>();
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

function normalizeTopic(text: string) {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function topicKeywords(text: string) {
  return normalizeTopic(text)
    .split(' ')
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function topicFingerprint(text: string) {
  const tokens = topicKeywords(text);
  const normalized = normalizeTopic(text);
  const allTokens = normalized.split(' ').filter(Boolean);
  const bigrams = new Set<string>();
  for (let i = 0; i < allTokens.length - 1; i++) {
    bigrams.add(`${allTokens[i]} ${allTokens[i + 1]}`);
  }

  return {
    normalized,
    tokenSet: new Set(tokens),
    bigrams,
  };
}

function jaccardSimilarity(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function isNearDuplicate(candidate: string, previous: string[]) {
  const c = topicFingerprint(candidate);

  return previous.some((past) => {
    const p = topicFingerprint(past);

    const textScore = stringSimilarity.compareTwoStrings(c.normalized, p.normalized);
    const keywordScore = jaccardSimilarity(c.tokenSet, p.tokenSet);
    const bigramScore = jaccardSimilarity(c.bigrams, p.bigrams);
    const sharedKeywords = [...c.tokenSet].filter((token) => p.tokenSet.has(token)).length;

    return (
      textScore > 0.72 ||
      keywordScore > 0.6 ||
      bigramScore > 0.35 ||
      sharedKeywords >= 4 ||
      (textScore > 0.62 && keywordScore > 0.45)
    );
  });
}

function getRecentSelectionsForNiche(niche: string) {
  const now = Date.now();
  const recent = recentSelectionsByNiche.get(niche) || [];
  const filtered = recent.filter((item) => now - item.at <= RECENT_SELECTION_TTL_MS);
  recentSelectionsByNiche.set(niche, filtered);
  return filtered.map((item) => item.topic);
}

function rememberRecentSelection(niche: string, topic: string) {
  const recent = recentSelectionsByNiche.get(niche) || [];
  recent.push({ topic, at: Date.now() });
  recentSelectionsByNiche.set(niche, recent);
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

  const nicheHistory = history
    .map((entry) => {
      const parts = entry.split('::');
      const entryNiche = (parts[0] || '').trim();
      const topic = (parts[parts.length - 1] || entry).trim();
      return { entryNiche, topic };
    })
    .filter((x) => x.topic)
    .filter((x) => x.entryNiche === niche)
    .map((x) => x.topic)
    .slice(-HISTORY_LOOKBACK);

  const acceptedThisRun: string[] = [];
  const recentSelections = getRecentSelectionsForNiche(niche);

  for (const candidate of candidates) {
    const comparedPool = [...nicheHistory, ...recentSelections, ...acceptedThisRun];
    const hasNearDuplicate = isNearDuplicate(candidate, comparedPool);

    if (!hasNearDuplicate) {
      acceptedThisRun.push(candidate);
      rememberRecentSelection(niche, candidate);
      await appendJson(PATHS.topics.history, `${niche} :: ${candidate}`);
      return candidate;
    }
  }

  return null;
}
