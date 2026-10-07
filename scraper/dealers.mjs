// Car showrooms in India for the brands we list, from OpenStreetMap (Overpass API).
// Writes site/data/dealers.json: [{b: brand, n: name, la, lo, a: address, c: city, p: pincode, t: phone, w: website}]
// Usage: node scraper/dealers.mjs
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'site/data/dealers.json');
const EP = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = 'RightRide/1.0 (https://aksreedevi.in/rightride)';

// brand → patterns matched against brand/name/operator tags
const BRANDS = {
  'Maruti Suzuki': /maruti|nexa|\barena\b|true value/i,
  Hyundai: /hyundai|huyndai|hyundia/i, Tata: /\btata\b(?!.*(steel|power|sky|1mg|croma))/i, Mahindra: /mahindra(?!.*(finance|first choice))/i,
  Kia: /\bkia\b/i, Lexus: /lexus/i, Toyota: /toyota/i, Honda: /honda(?!.*(two|bike|scooter|motorcycle|2 wheel))/i, MG: /\bmg\b|morris garages|mg motor/i,
  Skoda: /skoda|škoda/i, Volkswagen: /volkswagen|\bvw\b/i, Renault: /renault/i, Nissan: /nissan|datsun/i, Jeep: /\bjeep\b/i,
  'Mercedes-Benz': /mercedes/i, MINI: /\bmini\b(?!.*(truck|bus|cooper store))/i, BMW: /\bbmw\b/i, Audi: /\baudi\b/i, Jaguar: /jaguar/i, 'Land Rover': /land rover|range rover|\bjlr\b/i,
  'Citroën': /citro[eë]n/i, BYD: /\bbyd\b/i, Volvo: /volvo(?!.*(bus|truck|eicher|construction|\bce\b))/i, Porsche: /porsche/i, Isuzu: /isuzu/i,
  'Force Motors': /force motors|\bforce\b.*(gurkha|showroom|dealer)/i, VinFast: /vinfast/i, Tesla: /\btesla\b/i,
};
// spelling fixes for dealer names as mapped in OpenStreetMap
const NAME_FIX = [[/\bHuyndai\b|\bHyundia\b|\bHundai\b/gi, 'Hyundai'], [/\bMahindara\b/gi, 'Mahindra'], [/\bToyata\b/gi, 'Toyota'], [/\bMaruthi\b/gi, 'Maruti'], [/^Blu Hyundai\b/i, 'Blue Hyundai']];
const fixName = (n) => NAME_FIX.reduce((s, [re, to]) => s.replace(re, to), n.trim());
const NOT_CARS = /two.?wheel|bike|scooter|motorcycle|tvs|bajaj|hero|royal enfield|yamaha|suzuki motorcycle|ather|ola electric|used car|pre.?owned|true value|spinny|cars24|carwale|service centre only|tyre/i;

const tiles = [];
for (let la = 6; la < 37; la += 4) for (let lo = 68; lo < 98; lo += 5) tiles.push([la, lo, Math.min(la + 4, 37.5), lo + 5]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CACHE = process.env.DEALER_CACHE || '';
async function q(bb) {
  const cf = CACHE && path.join(CACHE, bb.join('_') + '.json');
  if (cf && fs.existsSync(cf)) return JSON.parse(fs.readFileSync(cf, 'utf8'));
  const res = await q0(bb);
  if (cf && res) { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(cf, JSON.stringify(res)); }
  return res;
}
async function q0(bb) {
  const ql = `[out:json][timeout:90];nwr["shop"="car"](${bb.join(',')});out center tags;`;
  for (let i = 0; i < 6; i++) {
    const ep = EP[i % EP.length];
    try {
      const r = await fetch(ep, { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(ql), signal: AbortSignal.timeout(120000) });
      if (r.ok) return (await r.json()).elements || [];
    } catch (e) {}
    await sleep(5000 * (i + 1));
  }
  console.error('tile failed', bb.join(','));
  return null;
}
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
const out = [], seen = new Set();
let failed = 0;
const failedTiles = [];
for (const [s, w, n, e] of tiles) {
  const els = await q([s, w, n, e]);
  if (!els) { failed++; failedTiles.push([s, w, n, e]); continue; }
  for (const el of els) {
    const t = el.tags || {};
    const hay = `${t.brand || ''} ${t.name || ''} ${t.operator || ''} ${t['brand:en'] || ''}`;
    if (!t.name || NOT_CARS.test(hay) && !/nexa|arena/i.test(hay)) continue;
    const brand = Object.keys(BRANDS).find((b) => BRANDS[b].test(hay));
    if (!brand) continue;
    const la = el.lat ?? el.center?.lat, lo = el.lon ?? el.center?.lon;
    if (la == null) continue;
    const key = `${brand}|${t.name}|${la.toFixed(3)}|${lo.toFixed(3)}`;
    if (seen.has(key)) continue; seen.add(key);
    const addr = t['addr:full'] || [t['addr:housenumber'], t['addr:street'], t['addr:suburb'] || t['addr:neighbourhood'] || t['addr:place']].filter(Boolean).join(', ');
    const d = { b: brand, n: fixName(t.name), la: +la.toFixed(5), lo: +lo.toFixed(5) };
    if (addr) d.a = addr;
    if (t['addr:city'] || t['addr:district']) d.c = t['addr:city'] || t['addr:district'];
    if (t['addr:postcode']) d.p = String(t['addr:postcode']).replace(/\s/g, '');
    const ph = t.phone || t['contact:phone'] || t['contact:mobile'] || t.mobile;
    if (ph) d.t = ph.split(/[;,]/)[0].trim();
    if (t.website || t['contact:website']) d.w = t.website || t['contact:website'];
    out.push(d);
  }
  await sleep(1500);
}
// a tile that failed this time keeps last week's showrooms, so one slow server can't wipe out a region
const rebrand = (d) => { const b = Object.keys(BRANDS).find((k) => BRANDS[k].test(d.n)); return b && b !== d.b && ['Lexus', 'MINI', 'Jaguar'].includes(b) ? b : d.b; };
let kept = 0;
for (const [s, w, n, e] of failedTiles) {
  for (const d of prev) {
    if (d.la < s || d.la >= n || d.lo < w || d.lo >= e) continue;
    const x = { ...d, n: fixName(d.n) }; x.b = rebrand(x);
    const key = `${x.b}|${x.n}|${x.la.toFixed(3)}|${x.lo.toFixed(3)}`;
    if (seen.has(key)) continue; seen.add(key); out.push(x); kept++;
  }
}
if (failedTiles.length) console.log(`${failedTiles.length} tiles failed; kept ${kept} showrooms from the previous run there`);
if (failed > tiles.length / 3 && prev.length > out.length) { console.log(`too many failed tiles (${failed}); keeping previous ${prev.length} dealers`); process.exit(0); }
fs.writeFileSync(OUT, JSON.stringify(out));
const by = {}; for (const d of out) by[d.b] = (by[d.b] || 0) + 1;
console.log(`dealers: ${out.length} (failed tiles ${failed}/${tiles.length}), with phone ${out.filter((d) => d.t).length}, with address ${out.filter((d) => d.a).length}`, by);
