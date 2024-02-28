import { mkdir } from 'node:fs/promises';

const template = await Bun.file('index.html').text();
const data = await Bun.file('data/chrome-data.json').text();
const output = template.replace(/\/\* loadData \*\/[\s\S]*?\/\* \/loadData \*\//, `return ${data};`);
await mkdir('dist', { recursive: true });
await Bun.write('dist/index.html', output);
