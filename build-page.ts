import { mkdir, readFile, writeFile } from 'node:fs/promises';

const template = await readFile('index.html', 'utf8');
const data = await readFile('data/chrome-data.json', 'utf8');
const output = template.replace(
  /\/\* loadData \*\/[\s\S]*?\/\* \/loadData \*\//,
  `return ${data};`,
);
await mkdir('dist', { recursive: true });
await writeFile('dist/index.html', output);
