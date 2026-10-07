// Tells Bing (and other IndexNow search engines: Yandex, Seznam, Naver) the moment car pages change,
// instead of waiting for their next crawl. Two steps in the "Deploy site" workflow:
//   node tools/indexnow.mjs diff    before deploying: compare the new data with what's live, list changed pages
//   node tools/indexnow.mjs submit  after deploying: send that list (no-op when nothing changed)
//   node tools/indexnow.mjs all     send every URL in the sitemap (one-off, e.g. first launch)
// The key below is public by design: IndexNow checks it by fetching https://rightride.in/<key>.txt
import fs from 'node:fs';
import path from 'node:path';

const KEY = '834c6986bca25707563565d1320c6036';
const HOST = 'rightride.in', ORIGIN = 'https://' + HOST;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LIST = path.join(ROOT, '.indexnow-urls.json');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const mode = process.argv[2];

async function diff() {
  const now = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/api/models.json'), 'utf8'));
  let live = { models: [] };
  try { const r = await fetch(`${ORIGIN}/api/models.json?t=${Date.now()}`); if (r.ok) live = await r.json(); } catch (e) {}
  const sig = (m) => JSON.stringify([m.priceMin, m.priceMax, m.safety, m.expertScore, m.variants]);
  const before = new Map(live.models.map((m) => [m.url, sig(m)]));
  const changed = now.models.filter((m) => before.get(m.url) !== sig(m));
  const gone = [...before.keys()].filter((u) => !now.models.some((m) => m.url === u));
  const urls = new Set([...changed.map((m) => m.url), ...gone]);
  for (const m of changed) urls.add(`${ORIGIN}/brands/${slug(m.brand)}/`);
  if (urls.size) { urls.add(`${ORIGIN}/cars/`); urls.add(`${ORIGIN}/llms.txt`); }
  fs.writeFileSync(LIST, JSON.stringify([...urls]));
  console.log(`IndexNow: ${changed.length} changed and ${gone.length} removed models -> ${urls.size} URLs queued`);
}

async function submit(urls) {
  if (!urls.length) { console.log('IndexNow: nothing changed'); return; }
  const r = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `${ORIGIN}/${KEY}.txt`, urlList: urls.slice(0, 10000) }) });
  console.log(`IndexNow: sent ${urls.length} URLs, HTTP ${r.status}`);
}

if (mode === 'diff') await diff();
else if (mode === 'submit') await submit(fs.existsSync(LIST) ? JSON.parse(fs.readFileSync(LIST, 'utf8')) : []);
else if (mode === 'all') { const xml = await (await fetch(`${ORIGIN}/sitemap.xml?t=${Date.now()}`)).text(); await submit([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).concat(`${ORIGIN}/llms.txt`)); }
else console.log('usage: node tools/indexnow.mjs diff|submit|all');
