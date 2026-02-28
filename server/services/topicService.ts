import Parser from 'rss-parser';
import axios from 'axios';
import { readJson, appendJson, PATHS } from '../db';
import stringSimilarity from 'string-similarity';

const parser = new Parser();

const SOURCES = {
  'Romance & Pig-Butchering Crypto Scams': [
    'https://www.fbi.gov/rss/news',
    'https://www.consumer.ftc.gov/blog/rss',
    'https://krebsonsecurity.com/feed/'
  ],
  'AI-Driven & Deepfake Crypto Scams': [
    'https://techcrunch.com/tag/deepfake/feed/',
    'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml'
  ],
  'Crypto Scam Statistics & Big Numbers': [
    'https://cointelegraph.com/rss/tag/scam',
    'https://www.coindesk.com/arc/outboundfeeds/rss/'
  ]
};

export async function discoverTopics(niche: string): Promise<string[]> {
  const feeds = SOURCES[niche as keyof typeof SOURCES] || [];
  let topics: string[] = [];

  for (const url of feeds) {
    try {
      const feed = await parser.parseURL(url);
      topics.push(...feed.items.map(item => item.title || ''));
    } catch (e) {
      console.error(`Error fetching feed ${url}:`, e);
    }
  }

  // Normalize and filter
  return topics
    .map(t => t.trim())
    .filter(t => t.length > 10)
    .slice(0, 50);
}

export async function getUniqueTopic(niche: string, candidates: string[]): Promise<string | null> {
  const history = await readJson<string[]>(PATHS.topics.history);
  
  for (const candidate of candidates) {
    let isUnique = true;
    for (const pastTopic of history) {
      const similarity = stringSimilarity.compareTwoStrings(
        candidate.toLowerCase(),
        pastTopic.toLowerCase()
      );
      if (similarity > 0.7) {
        isUnique = false;
        break;
      }
    }
    
    if (isUnique) {
      await appendJson(PATHS.topics.history, candidate);
      return candidate;
    }
  }

  return null;
}
