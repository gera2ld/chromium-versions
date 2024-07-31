import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';

const platforms: string[] = ['Mac', 'Win_x64', 'Linux_x64'];

await mkdir('data', { recursive: true });
const revisionMap: Record<string, number[]> = {};
const revisionData: Record<string, Record<number, number>> = {};

async function getSnapshots(platform: string) {
  let total = 0;
  const baseUrl =
    `https://www.googleapis.com/storage/v1/b/chromium-browser-snapshots/o?delimiter=/&prefix=${platform}/&fields=items(kind,mediaLink,metadata,name,size,updated),kind,prefixes,nextPageToken`;
  let pageToken: string | undefined;
  process.stdout.write(`\rLoading snapshots for ${platform}...`);
  while (true) {
    let url = baseUrl;
    if (pageToken) url = `${baseUrl}&pageToken=${pageToken}`;
    const res = await fetch(url);
    const { nextPageToken, prefixes } = (await res.json()) as {
      nextPageToken?: string;
      prefixes: string[];
    };
    const items = prefixes
      .flatMap((prefix) => {
        const [platform, rev] = prefix.split('/');
        const revision = +rev;
        return revision ? { platform, revision } : [];
      });
    for (const item of items) {
      revisionMap[item.platform] ??= [];
      revisionMap[item.platform].push(item.revision);
    }
    total += items.length;
    process.stdout.write(`\rLoading snapshots for ${platform}...${total}`);
    pageToken = nextPageToken;
    if (!pageToken) break;
  }
  console.log();
}

async function getBranches() {
  const res = await fetch('https://chromiumdash.appspot.com/fetch_milestones');
  const items = (await res.json()) as Array<{
    chromium_main_branch_position: number;
    milestone: number;
  }>;
  items.sort((a, b) =>
    a.chromium_main_branch_position - b.chromium_main_branch_position
  );
  for (const platform of platforms) {
    revisionData[platform] = {};
    const revisions = revisionMap[platform].sort((a, b) => a - b);
    let offset = 0;
    for (const item of items) {
      while (
        revisions[offset] &&
        revisions[offset] <= item.chromium_main_branch_position
      ) {
        revisionData[platform][item.milestone] = revisions[offset];
        offset += 1;
      }
    }
  }
}

async function loadData() {
  for (const platform of platforms) {
    await getSnapshots(platform);
  }
  await getBranches();
  const data = {
    time: new Date().toISOString(),
    revisionData,
  };
  await writeFile('data/chrome-data.json', JSON.stringify(data, null, 2));
}

await loadData();
