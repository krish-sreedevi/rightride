// Per-model extras for the car page:
//  - colours (name + studio photo) and interior photos, from Autocar India's model gallery
//  - real-world mileage per powertrain (Autocar India tested city/highway, owner-reported, ARAI)
//  - user ratings from Autocar India, ZigWheels, CarWale and CarDekho (schema.org aggregateRating)
//  - periodic maintenance cost over 5 years per powertrain, from V3Cars
// Writes data/extras.json: { updated, models: { "Brand|Model": { colors, interior, mileage, ratings, service } } }
// Usage: node scraper/model-extras.mjs   (env: EX_ONLY="Brand|Model,…", EX_CONC=6)
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'data/extras.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en-IN,en;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      if (r.status === 404 || r.status === 410) return null;
      if (r.ok) return { html: await r.text(), url: r.url };
    } catch (e) {}
    await sleep(1200 * (i + 1));
  }
  return undefined;
}
const unesc = (h) => h.replace(/\\"/g, '"').replace(/\\u0026/g, '&');
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' | ').replace(/&amp;/g, '&').replace(/&rarr;|&nbsp;/g, ' ').replace(/\s+/g, ' ').replace(/( \|)+ /g, ' | ');
// schema.org rating (first AggregateRating with a count)
function aggRating(h) {
  for (const m of h.matchAll(/"aggregateRating"\s*:\s*\{([^{}]*)\}/g)) {
    const b = m[1];
    const v = parseFloat((b.match(/"ratingValue"\s*:\s*"?([\d.]+)/) || [])[1]);
    const n = parseInt((b.match(/"(?:ratingCount|reviewCount)"\s*:\s*"?(\d+)/) || [])[1], 10);
    const best = parseFloat((b.match(/"bestRating"\s*:\s*"?([\d.]+)/) || [])[1] || 5);
    if (v > 0 && best) return { r: Math.round((v / best) * 5 * 100) / 100, n: Number.isFinite(n) ? n : null };
  }
  return null;
}
const BRAND = {
  cw: { 'Maruti Suzuki': 'maruti-suzuki', 'Mercedes-Benz': 'mercedes-benz', 'Land Rover': 'land-rover', MG: 'mg' },
  cd: { 'Maruti Suzuki': 'maruti', 'Mercedes-Benz': 'mercedes-benz', 'Land Rover': 'land-rover', MG: 'mg' },
  v3: { 'Maruti Suzuki': 'maruti-suzuki', 'Mercedes-Benz': 'mercedes-benz', 'Land Rover': 'land-rover', MG: 'mg' },
};
const modelSlugs = (model) => [...new Set([slugify(model), slugify(model.replace(/\s+(EV|Lwb|LWB)$/i, '')), slugify(model).replace(/-/g, '')])];

// Autocar India model page: gallery + mileage table + rating
const INTERIOR_ORDER = ['dashboard', 'full-cabin-view', 'front-row-seats', 'second-row-seats', 'third-row-seats', 'infotainment-system', 'steering-wheel', 'instrument-cluster', 'digital-instrument-cluster', 'centre-console', 'boot'];
async function autocar(slug) {
  const r = await get(`https://www.autocarindia.com/cars/${slug}`);
  if (!r) return r;
  const h = unesc(r.html);
  const imgs = [...h.matchAll(/\{"image":"(https:[^"]+)","caption":"([^"]*)","alt_text":"[^"]*","id":\d+,"primary_tag":"([^"]*)","category":"([^"]*)"/g)].map((m) => ({ u: m[1], cap: m[2], tag: m[3], cat: m[4] }));
  const seen = new Set();
  const colors = [];
  for (const x of imgs) if (x.cat === 'exterior' && /^color-/.test(x.tag) && !seen.has(x.tag)) { seen.add(x.tag); colors.push({ name: x.cap.replace(/^Colou?r\s+/i, '').replace(/\s{2,}/g, ' + ').trim(), img: x.u }); }
  const own = new RegExp(`autocarindia\\.com/${slug.replace('/', '/')}/`, 'i');
  let interior = imgs.filter((x) => x.cat === 'interior');
  const current = interior.filter((x) => own.test(x.u));
  if (current.length >= 3) interior = current;
  const rank = (x) => { const i = INTERIOR_ORDER.findIndex((t) => x.tag.startsWith(t)); return i < 0 ? 99 : i; };
  const intSeen = new Set();
  interior = interior.slice().sort((a, b) => rank(a) - rank(b)).filter((x) => !intSeen.has(x.tag) && intSeen.add(x.tag)).slice(0, 8).map((x) => ({ cap: x.cap, img: x.u }));
  // mileage table (first occurrence)
  const mi = h.indexOf('"user_reported_mileage"');
  let mileage = [];
  if (mi > 0) {
    const start = h.lastIndexOf('"data":[', mi);
    const end = h.indexOf(']', mi);
    try {
      const rows = JSON.parse(h.slice(start + 7, end + 1));
      const num = (s) => { const v = parseFloat(String(s || '').replace(/[^\d.]/g, '')); return Number.isFinite(v) && v > 0 ? v : null; };
      mileage = rows.map((x) => ({ fuel: x.fuel_type, tr: x.transmission_type, cc: x.displacement, ev: !!x.is_electric, arai: num(x.mileage), user: num(x.user_reported_mileage), tested: num(x.autocar_tested_mileage), city: num(x.autocar_tested_city), hwy: num(x.autocar_tested_highway), evRange: num(x.autocar_tested_ev_range) }));
    } catch (e) {}
  }
  return { colors, interior, mileage, rating: aggRating(h), url: r.url };
}
// V3Cars: 5-year periodic service cost per powertrain
async function v3(brand, model) {
  for (const m of modelSlugs(model)) {
    const r = await get(`https://www.v3cars.com/${BRAND.v3[brand] || slugify(brand)}-cars/${m}/maintenance-cost`);
    if (r === undefined) return undefined;
    if (!r || !/maintenance-cost/.test(r.url)) continue;
    const s = strip(r.html);
    const out = [];
    for (const mm of s.matchAll(/\| ([^|]{2,60}?) \| TOTAL & AVERAGE PERIODIC SERVICE COST \|[\s\S]*?\| Total \| Rs\. ([\d,]+) \| Rs\. ([\d,]+) \|/g)) {
      out.push({ pt: mm[1].trim(), y3: +mm[2].replace(/,/g, ''), y5: +mm[3].replace(/,/g, '') });
    }
    if (out.length) return { url: r.url, list: out };
  }
  return null;
}
async function ratingAt(urls) {
  for (const u of urls) {
    const r = await get(u);
    if (r === undefined) return undefined;
    if (!r) continue;
    const a = aggRating(r.html);
    if (a) return { ...a, url: r.url };
  }
  return null;
}

async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const j = i++; await fn(items[j], j); } })); }

async function main() {
  const cars = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/cars.json'), 'utf8')).cars;
  const xp = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/expert.json'), 'utf8')).models || {}; } catch (e) { return {}; } })();
  const zw = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/zigwheels-features.json'), 'utf8')).models || {}; } catch (e) { return {}; } })();
  const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { return { models: {} }; } })();
  let keys = [...new Set(cars.map((c) => c.brand + '|' + c.model))];
  if (process.env.EX_ONLY) { const only = process.env.EX_ONLY.split(','); keys = keys.filter((k) => only.includes(k)); }
  const out = { updated: new Date().toISOString(), models: { ...prev.models } };
  await pool(keys, Number(process.env.EX_CONC || 6), async (k) => {
    const [brand, model] = k.split('|');
    const old = prev.models[k] || {};
    const acSlug = (xp[k] && xp[k].slug) || `${slugify(brand)}/${slugify(model)}`;
    const zwBase = zw[k] && zw[k].slug;
    const ms = modelSlugs(model);
    const [ac, rz, rcw, rcd, sv] = await Promise.all([
      autocar(acSlug),
      zwBase ? ratingAt([`https://www.zigwheels.com/${zwBase}`]) : Promise.resolve(null),
      ratingAt(ms.map((m) => `https://www.carwale.com/${BRAND.cw[brand] || slugify(brand)}-cars/${m}/`)),
      ratingAt(ms.map((m) => `https://www.cardekho.com/${BRAND.cd[brand] || slugify(brand)}/${m}`)),
      v3(brand, model),
    ]);
    const keep = (v, o) => (v === undefined ? o : v); // network failure: keep last good value
    const e = {
      colors: ac === undefined ? old.colors : (ac && ac.colors) || [],
      interior: ac === undefined ? old.interior : (ac && ac.interior) || [],
      mileage: ac === undefined ? old.mileage : (ac && ac.mileage) || [],
      ratings: {
        autocar: ac === undefined ? (old.ratings || {}).autocar : ac && ac.rating ? { ...ac.rating, url: ac.url } : null,
        zigwheels: keep(rz, (old.ratings || {}).zigwheels),
        carwale: keep(rcw, (old.ratings || {}).carwale),
        cardekho: keep(rcd, (old.ratings || {}).cardekho),
      },
      service: keep(sv, old.service),
    };
    out.models[k] = e;
    console.log(`${k}: ${e.colors.length} colours, ${e.interior.length} interior, ${e.mileage.length} powertrains, ratings ${Object.entries(e.ratings).filter(([, v]) => v).map(([s, v]) => `${s} ${v.r}(${v.n})`).join(' ')}${e.service ? `, service ${e.service.list.map((x) => x.y5).join('/')}` : ''}`);
  });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('done', keys.length);
}
main();
