import fs from 'node:fs/promises';
import path from 'node:path';

const files = [
  'server/db.ts',
  'server/scheduler.ts',
  'server/services/facebookService.ts',
  'server/services/keyService.ts',
  'server/services/supabaseKeyStore.ts',
  'server/services/topicService.ts',
  'server/services/videoService.ts',
  'src/pages/Settings.tsx',
];

const markerRegex = /^(<<<<<<<|=======|>>>>>>>) /m;

const failed = [];
for (const relativeFile of files) {
  const absolutePath = path.resolve(process.cwd(), relativeFile);
  const content = await fs.readFile(absolutePath, 'utf8');
  if (markerRegex.test(content)) {
    failed.push(relativeFile);
  }
}

if (failed.length > 0) {
  console.error('Merge conflict markers found in:');
  for (const file of failed) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

console.log('No merge conflict markers found in checked files.');
