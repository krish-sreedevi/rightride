// Collects Autocar India expert-review scores, likes/dislikes and review videos for every model we list.
// Usage: node scraper/expert.mjs   (reads site/data/cars.json or data/raw + curated via normalize output; writes data/expert.json)
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'data/expert.json');
const BASE = 'https://www.autocarindia.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const BRAND_SLUG = { 'Maruti Suzuki': 'maruti-suzuki', 'Mercedes-Benz': 'mercedes-benz', 'Land Rover': 'land-rover' };
// our model name -> Autocar slug, when the obvious slug differs
const SLUG = {
  'Honda|Amaze - 2nd Gen': null,
  'Mahindra|XUV 3XO': 'xuv-3xo', 'Mahindra|XUV 7XO': 'xuv-7xo', 'Mahindra|Scorpio-N': 'scorpio-n',
  'MG|Hector Plus 6 Seater': 'hector-plus',
  'Land Rover|Defender 110': 'defender', 'Land Rover|Defender 90': 'defender', 'Land Rover|Defender 130': 'defender',
  'Maruti Suzuki|WagonR': 'wagon-r',
  'MG|Windsor EV': 'windsor', 'MG|Windsor Pro': 'windsor', 'MG|Comet EV': 'comet',
  'Toyota|Land Cruiser 300': 'land-cruiser',
};
// no review of its own: borrow the review of the car it is built on (shown as "based on …")
const BASED_ON = {
  'Hyundai|Creta N Line': 'hyundai/creta', 'Hyundai|Venue N Line': 'hyundai/venue', 'Hyundai|i20 N Line': 'hyundai/i20',
  'BMW|i5 Lwb': 'bmw/i5', 'Toyota|Legender': 'toyota/fortuner', 'Mahindra|Bolero Neo Plus': 'mahindra/bolero-neo',
};

const slugify = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en-IN' }, signal: AbortSignal.timeout(30000) });
      if (r.status === 404) return null;
      if (r.ok) return (await r.text()).replace(/\\"/g, '"');
    } catch (e) {}
    await sleep(1500 * (i + 1));
  }
  return undefined; // network failure (not a 404)
}
const VIDEO_RE = /"@type":"VideoObject","name":"([^"]+)"[\s\S]{0,400}?"uploadDate":"(\d{4})[\s\S]{0,200}?"contentUrl":"https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/g;
const isReview = (t, y = 2099) => y >= 2023 && /review|road test|first drive|test drive|driven|tested/i.test(t) && !/walkaround|launch|unveil|interview|teaser|podcast|news|crash test/i.test(t);
const unq = (s) => s.replace(/\\u0026#8217;|&#8217;|\\u2019/g, '’').replace(/\\u0026amp;|&amp;/g, '&').replace(/\\u0026#8216;|&#8216;/g, '‘').replace(/\\u0026/g, '&');
const list = (s) => { try { return JSON.parse(s).map(unq); } catch (e) { return [...s.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => unq(x[1])); } };

function parse(h) {
  const i = h.indexOf('"expert_review":{"like":');
  if (i < 0) return null;
  const seg = h.slice(i, h.indexOf('"author_details"', i) > 0 ? h.indexOf('"author_details"', i) : i + 20000);
  const like = (seg.match(/"like":(\[[^\]]*\])/) || [])[1] || '[]';
  const dislike = (seg.match(/"dislike":(\[[^\]]*\])/) || [])[1] || '[]';
  const R = {};
  for (const x of seg.matchAll(/"rating":"?([\d.]+)"?,"details":[\s\S]*?"type":"([a-z_]+)","display_name"/g)) R[x[2]] = +x[1];
  const score = +((h.match(/"auto_rating":"?([\d.]+)/) || [])[1] || 0) || null;
  const vids = [...h.matchAll(VIDEO_RE)].map((x) => ({ t: unq(x[1]), y: +x[2], id: x[3] }));
  const rs = [...h.matchAll(/"type":"(First Drive|Road Test|Review)","category":"[^"]*","title":"([^"]+)","url":"([^"]+)"/g)].map((x) => ({ title: unq(x[2]), url: x[3] }));
  return { score, R, like: list(like), dislike: list(dislike), vids, rs };
}

async function expertFor(slug) {
  const name = slug.split('/')[1].replace(/^new-/, '').replace(/-/g, ' ');
  const fits = (t) => { const T = t.toLowerCase(); return T.includes(name.split(' ')[0]) && (!/n line|electric|\bev\b|cng/.test(T) || /n line|electric|\bev\b|cng/.test(name)); };
  const h = await get(`${BASE}/cars/${slug}/expert-reviews`);
  if (h === undefined) return { slug, err: true };
  if (!h) return null;
  const p = parse(h);
  if (!p) return { slug, none: true };
  let video = p.vids.find((v) => isReview(v.t, v.y) && fits(v.t));
  if (!video) {
    const vh = await get(`${BASE}/cars/${slug}/videos`);
    const vids = vh ? [...vh.matchAll(VIDEO_RE)].map((x) => ({ t: unq(x[1]), y: +x[2], id: x[3] })) : [];
    video = vids.find((v) => isReview(v.t, v.y) && fits(v.t)) || null;
  }
  const r = p.R, avg = (...xs) => { const v = xs.filter((x) => x != null); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };
  return {
    slug, score: p.score,
    scores: {
      features: r.features_and_safety ?? null,
      mileage: r.mileage__range_and_efficiency ?? null,
      comfort: avg(r.interior_space_and_comfort, r.ride_comfort_and_handling),
      value: r.value_for_money ?? null,
      performance: r.performance_and_refinement ?? null,
      design: r.exterior_design_and_engineering ?? null,
    },
    like: p.like, dislike: p.dislike,
    video: video ? { id: video.id, title: video.t, year: video.y } : null,
    review: p.rs.find((x) => fits(x.title)) || p.rs[0] || null,
  };
}


// Autocar India's own YouTube review for a model (search results page → ytInitialData)
async function youtubeReview(brand, model) {
  const q = `autocar india ${brand} ${model} review`;
  const h = await get(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=en`);
  if (!h) return null;
  const m = h.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) return null;
  let d; try { d = JSON.parse(m[1]); } catch (e) { return null; }
  const vids = [];
  (function walk(o) {
    if (Array.isArray(o)) { for (const x of o) walk(x); return; }
    if (!o || typeof o !== 'object') return;
    if (o.videoRenderer) {
      const v = o.videoRenderer, runs = (r) => (r && r.runs ? r.runs.map((x) => x.text).join('') : '');
      vids.push({ id: v.videoId, ch: runs(v.ownerText), t: runs(v.title), ago: (v.publishedTimeText || {}).simpleText || '' });
    }
    for (const k in o) walk(o[k]);
  })(d);
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const name = norm(model.replace(/^(mercedes[- ](amg|maybach)?)/i, '').replace(/\b(sedan|long|lwb|monogram series|6 seater|- 2nd gen)\b/gi, ''));
  const toks = name.split(' ').filter((w) => w && !['the', 'new'].includes(w));
  const SPECIAL = /\b(n line|electric|ev|cng|hybrid|phev|amg|rs|lwb|plus|coupe|sportback|n)\b/;
  const years = (ago) => { const x = ago.match(/(\d+)\s+(year|yr)/); return x ? +x[1] : 0; };
  const ok = vids.filter((v) => /autocar india/i.test(v.ch)).filter((v) => {
    const T = ' ' + norm(v.t) + ' ';
    if (!toks.every((w) => T.includes(' ' + w + ' '))) return false;
    if (/\bvs\b|podcast|walkaround|news|launch|unveil|crash test|explained|top 5|interview|teaser/.test(T)) return false;
    if (!/review|first drive|road test|long term|driven|test drive/.test(T)) return false;
    // don't match a sibling ("Creta N Line" for "Creta") unless our model has it too
    const words = T.trim().split(' '), last = words.indexOf(toks[toks.length - 1]);
    const next = words.slice(last + 1, last + 3).join(' ');
    const sib = next.match(/^(n line|electric|ev|cng|hybrid|phev|amg|rs|lwb|plus|coupe|sportback|n|classic|neo|roxx|og|clavis|cross|nightfall|suv)\b/);
    if (sib && !new RegExp('\\b' + sib[1] + '\\b').test(name)) return false;
    // an EV sibling named in the title (i5, iX1, EQS…) that isn't our model
    if (words.some((w) => /^(i\d|ix\d?|eq[a-z])$/.test(w) && !name.split(' ').includes(w))) return false;
    return years(v.ago) <= 4;
  });
  return ok[0] ? { id: ok[0].id, title: ok[0].t, ago: ok[0].ago, src: 'youtube' } : null;
}

// Autocar India's transparent studio image for a model page slug like "hyundai/creta"
async function imageFor(slug) {
  const [b, m] = slug.split('/');
  for (const name of [...new Set([m, m.replace(/^new-/, '')])]) {
    try {
      const r = await fetch(`https://asset.autocarindia.com/static/car-images/${b}_${name}.png?w=64`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
      if (r.ok && /image/.test(r.headers.get('content-type') || '')) return `${b}_${name}`;
    } catch (e) {}
  }
  return null;
}

const cars = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/cars.json'), 'utf8')).cars;
const allModels = [...new Set(cars.map((c) => `${c.brand}|${c.model}`))];
// EXPERT_SLICE=start:end processes part of the list (the rest keeps its previous data)
const [a0, b0] = (process.env.EXPERT_SLICE || '').split(':').map((x) => (x === '' ? undefined : Number(x)));
const models = allModels.slice(a0 ?? 0, b0 ?? allModels.length).filter((k) => !process.env.EXPERT_ONLY || new RegExp(process.env.EXPERT_ONLY, 'i').test(k));
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')).models || {} : {};
const out = { source: 'autocarindia.com expert reviews', updated: new Date().toISOString(), models: {} };
for (const k of allModels) if (!models.includes(k) && prev[k]) out.models[k] = prev[k];
const cache = new Map();
let n = 0;
const work = models.map((key) => async () => {
  const [brand, model] = key.split('|');
  const b = BRAND_SLUG[brand] || slugify(brand);
  const own = key in SLUG ? SLUG[key] : slugify(model).replace(/^mercedes-(amg-|maybach-)?/, (m, x) => (x === 'maybach-' ? 'maybach-' : '')).replace(/-sedan(-long)?$/, '').replace(/-monogram-series$/, '');
  const tries = own ? [`${b}/${own}`, `${b}/new-${own}`, `${b}/${own.replace(/-(lwb|ev)$/, '')}`] : [];
  let res = null;
  for (const s of [...new Set(tries)]) {
    if (!cache.has(s)) cache.set(s, expertFor(s));
    res = await cache.get(s);
    if (res && !res.none && !res.err) break;
  }
  if ((!res || res.none) && BASED_ON[key]) {
    const s = BASED_ON[key];
    if (!cache.has(s)) cache.set(s, expertFor(s));
    const r2 = await cache.get(s);
    if (r2 && !r2.none) res = { ...r2, basedOn: s.split('/')[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) };
  }
  if (res && res.err) { if (prev[key]) out.models[key] = prev[key]; n++; return; } // keep last good data on network errors
  const url = res ? `${BASE}/cars/${res.slug}/expert-reviews` : null;
  const yv = await youtubeReview(brand, model).catch(() => null);
  const image = res && res.slug ? await imageFor(res.slug) : null;
  if (res && !res.none) out.models[key] = { ...res, url, video: yv || res.video || null, image };
  else if (res || yv) out.models[key] = { slug: res ? res.slug : null, url, video: yv, image };
  n++;
});
// small worker pool, polite to the site
const pool = async (fns, k) => { const q = fns.slice(); await Promise.all(Array.from({ length: k }, async () => { while (q.length) await q.shift()(); })); };
await pool(work, 3);
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const vals = Object.values(out.models);
console.log(`expert: ${models.length}/${allModels.length} models, ${vals.filter((v) => v.score).length} scored, ${vals.filter((v) => v.video).length} with review video → ${path.relative(ROOT, OUT)}`);
