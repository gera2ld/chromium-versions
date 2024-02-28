import { mkdir } from 'node:fs/promises';
import { Database } from 'bun:sqlite';

interface IChromiumSnapshot {
  id: number;
  platform: string;
  revision: number;
  milestone: number;
}

const platforms: string[] = ['Mac', 'Win_x64', 'Linux_x64'];

const hasData = await Bun.file('data/chrome-data.sqlite').exists();
await mkdir('data', { recursive: true });
const db = new Database('data/chrome-data.sqlite');
db.run(`CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform VARCHAR,
  revision INTEGER,
  milestone INTEGER
)`);
db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots ON snapshots (platform, revision)`);

const insertSnapshot = db.prepare<number, [string, number]>(
	`INSERT OR IGNORE INTO snapshots (platform, revision) VALUES (?, ?)`
);
const insertSnapshots = db.transaction((snapshots: { platform: string; revision: number }[]) => {
	for (const snapshot of snapshots) {
		insertSnapshot.run(snapshot.platform, snapshot.revision);
	}
});

const updateMilestone = db.prepare<void, [number, number]>(
	'UPDATE snapshots SET milestone = ? WHERE milestone IS NULL AND revision <= ?'
);
const updateMilestones = db.transaction((items: { milestone: number; revision: number }[]) => {
	items.sort((a, b) => a.revision - b.revision);
	for (const item of items) {
		updateMilestone.run(item.milestone, item.revision);
	}
});

async function getSnapshots(platform: string) {
	let total = 0;
	const baseUrl = `https://www.googleapis.com/storage/v1/b/chromium-browser-snapshots/o?delimiter=/&prefix=${platform}/&fields=items(kind,mediaLink,metadata,name,size,updated),kind,prefixes,nextPageToken`;
	let pageToken: string | undefined;
	process.stdout.write(`\rLoading snapshots for ${platform}...`);
	while (true) {
		let url = baseUrl;
		if (pageToken) url = `${baseUrl}&pageToken=${pageToken}`;
		const res = await fetch(url);
		const data = (await res.json()) as { nextPageToken?: string; prefixes: string[] };
		const items = data.prefixes
			.map((prefix) => {
				const [platform, rev] = prefix.split('/');
				const revision = +rev;
				return revision ? { platform, revision } : [];
			})
			.flat();
		insertSnapshots(items);
		total += items.length;
		process.stdout.write(`\rLoading snapshots for ${platform}...${total}`);
		pageToken = data.nextPageToken;
		if (!pageToken) break;
	}
	console.log();
}

async function getBranches() {
	const res = await fetch('https://chromiumdash.appspot.com/fetch_milestones');
	const data = (await res.json()) as Array<{
		chromium_main_branch_position: number;
		milestone: number;
	}>;
	updateMilestones(
		data.map((item) => ({
			milestone: item.milestone,
			revision: item.chromium_main_branch_position
		}))
	);
}

function getSnapshotUrl(platform: string, revision: number) {
	return `https://commondatastorage.googleapis.com/chromium-browser-snapshots/index.html?prefix=${platform}/${revision}/`;
}

async function loadData() {
	for (const platform of platforms) {
		await getSnapshots(platform);
	}
	await getBranches();
	db.run('VACUUM');
}

async function exportToCsv() {
	console.log('Exporting to CSV...');
	const rows = db
		.query<IChromiumSnapshot, []>('SELECT * FROM snapshots WHERE milestone IS NOT NULL GROUP BY milestone, platform ORDER BY revision DESC')
		.all();
	const headers = Object.keys(rows[0]) as (keyof IChromiumSnapshot)[];
	const content = [
		[...headers, 'URL'],
		...rows.map((row) => [
			...headers.map((key) => row[key]),
			getSnapshotUrl(row.platform, row.revision)
		])
	]
		.map((row) => row.join(','))
		.join('\n');
	await Bun.write('data/chrome-data.csv', content);
}

async function exportToJson() {
	console.log('Exporting to JSON...');
	const rows = db
		.query(
			'SELECT platform,MAX(revision) AS revision,milestone FROM snapshots WHERE milestone IS NOT NULL GROUP BY milestone, platform ORDER BY revision DESC'
		)
		.all();
	await Bun.write('data/chrome-data.json', JSON.stringify({
    time: Date.now(),
    rows,
  }));
}

if (!hasData) await loadData();
await exportToCsv();
await exportToJson();
