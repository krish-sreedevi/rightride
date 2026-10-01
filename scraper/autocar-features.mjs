// Variant-wise feature lists from Autocar India, for cars whose maker doesn't publish them
// (Mahindra, Toyota, Skoda, VW, Nissan, the luxury brands, and a few gaps elsewhere).
// For each such model: read /cars/<make>/<model>/variants, match our variants to Autocar's
// (fuel, gearbox, ex-showroom price), then read each matched variant page's feature table.
// Writes data/autocar-features.json: { updated, models: { "Brand|Model": { slug, variants: [{ n, s, fuel, tr, p, y: [keys], no: [keys], airbags }] } } }
// Usage: node scraper/autocar-features.mjs   (env: AF_ONLY="Brand|Model,…", AF_SLICE="i/n", AF_ALL=1 to include models that already have features)
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'data/autocar-features.json');
const BASE = 'https://www.autocarindia.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const BRAND_SLUG = { 'Maruti Suzuki': 'maruti-suzuki', 'Mercedes-Benz': 'mercedes-benz', 'Land Rover': 'land-rover' };
// our model → Autocar model slug, when it isn't the obvious one
const SLUG = {
  'Mahindra|XUV 3XO': 'mahindra/xuv-3xo', 'Mahindra|XUV 7XO': 'mahindra/xuv-7xo', 'Mahindra|Scorpio-N': 'mahindra/scorpio-n',
  'Land Rover|Defender 110': 'land-rover/defender', 'Land Rover|Defender 90': 'land-rover/defender', 'Land Rover|Defender 130': 'land-rover/defender',
  'Toyota|Land Cruiser 300': 'toyota/land-cruiser', 'Toyota|Legender': 'toyota/fortuner', 'Mahindra|Bolero Neo Plus': 'mahindra/bolero-neo-plus',
};

const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
  return undefined;
}
// pull one JSON value out of the Next.js page payload, starting at `key` (which ends with { or [)
function block(h, key) {
  let i = h.indexOf(key); if (i < 0) return null;
  i += key.length - 1;
  let d = 0, j = i, inS = false;
  for (; j < h.length; j++) {
    const c = h[j];
    if (inS) { if (c === '\\') { j++; continue; } if (c === '"') inS = false; continue; }
    if (c === '"') { inS = true; continue; }
    if (c === '{' || c === '[') d++;
    else if (c === '}' || c === ']') { d--; if (!d) break; }
  }
  try { return JSON.parse(h.slice(i, j + 1)); } catch (e) { return null; }
}

// Autocar feature table → our feature keys. Each rule returns true / false / undefined (unknown).
const on = (v) => (v === '' || v == null ? undefined : v === false || /^(no|none|false|na|n\/a|-)$/i.test(String(v).trim()) ? false : true);
const has = (re) => (v) => (on(v) === undefined ? undefined : on(v) ? re.test(String(v)) : false);
const anyOf = (...vals) => (vals.some((v) => on(v) === true) ? true : vals.some((v) => on(v) === false) ? false : undefined);
function mapFeatures(groups) {
  const T = {}, conn = [];
  for (const g of groups || []) for (const x of g.data || []) {
    T[x.title.trim().toLowerCase()] = x.value;
    if (/connected/i.test(g.title)) conn.push(x.value);
  }
  const v = (t) => T[t.toLowerCase()];
  const airbags = parseInt(v('Airbags'), 10);
  const f = {
    airbags6: Number.isFinite(airbags) ? airbags >= 6 : undefined,
    abs: on(v('Anti-Lock Brakes (ABS)')),
    esc: on(v('Electronic Stability Control')),
    hillAssist: on(v('Hill Start Assist')),
    hillDescent: on(v('Hill Descent Control')),
    tpms: on(v('Tyre Pressure Monitoring System')),
    isofix: on(v('ISOFIX Child Seat Mounts')),
    rearCamera: on(v('Parking Camera')),
    camera360: has(/360/)(v('Parking Camera')),
    rearSensors: has(/rear/i)(v('Parking Sensors')),
    frontSensors: has(/front/i)(v('Parking Sensors')),
    adas: anyOf(v('Auto emergency braking (AEB)'), v('Lane Keep Assist'), v('Adaptive Cruise Control'), v('Front Collision Avoidance')),
    blindSpot: on(v('Blind Spot Monitor')),
    touchscreen: has(/touch/i)(v('Display')),
    androidAuto: anyOf(v('Android Auto'), v('Apple CarPlay')),
    wirelessAA: (() => { const a = on(v('Android Auto')), b = on(v('Apple CarPlay')); if (a === undefined && b === undefined) return undefined; return /wireless/i.test(`${v('Android Auto')} ${v('Apple CarPlay')}`); })(),
    connected: conn.length ? anyOf(...conn) : undefined,
    digitalCluster: has(/fully/i)(v('Digital Instrument Cluster')),
    wirelessCharger: on(v('Wireless Phone Charging')),
    premiumAudio: on(v('Branded Music System')),
    hud: on(v('Head-up Display')),
    voiceCommands: on(v('Voice Commands')),
    autoClimate: (() => { const c = v('Climate Control'); return on(c) === undefined ? undefined : on(c) && !/manual/i.test(String(c)); })(),
    dualZone: has(/([2-4])-zone|dual|two|three|four/i)(v('Climate Control')),
    rearAC: on(v('Rear AC Vents')),
    cruise: anyOf(v('Cruise Control'), v('Adaptive Cruise Control')),
    keyless: on(v('Keyless Entry')),
    pushStart: on(v('Push Button Start')),
    poweredSeat: on(v("Electric Adjust for Driver's Seat")),
    ventilated: on(v('Ventilated Seats')),
    autoHeadlamps: on(v('Automatic Headlamps')),
    rainWipers: on(v('Automatic Wipers')),
    autoIRVM: has(/auto/i)(v('Day Night Interior Mirror') ?? v('Day/Night Interior Mirror')),
    foldingORVM: on(v('Exterior Mirrors Electric Fold')),
    epb: on(v('Electronic Parking Brake')),
    paddleShifters: on(v('Paddle Shifters')),
    driveModes: on(v('Driving Modes')),
    rearArmrest: on(v('Rear Seat Armrest')),
    powerTailgate: anyOf(v('Powered Tailgate'), v('Hands-free Boot Opening')),
    sunroof: on(v('Sunroof')),
    panoramic: has(/panoramic/i)(v('Sunroof')),
    dashcam: on(v('Dashcam')),
    ambient: on(v('Ambient Lighting')),
    leather: has(/leather/i)(v('Seat Material')),
    airPurifier: on(v('Air Purifier')),
    massage: on(v('Massage Seats')),
    captainSeats: on(v('Individual Chairs at Rear')),
    ledHeadlamps: anyOf(v('LED headlamps'), has(/led/i)(v('Headlight Type'))),
    ledDRL: anyOf(v('LED DRLs'), has(/led/i)(v('Daytime Running Lights'))),
    fogLamps: on(v('Front Fog Lamps')),
    roofRails: on(v('Roof Rails')),
  };
  const y = [], no = [];
  for (const [k, val] of Object.entries(f)) if (val === true) y.push(k); else if (val === false) no.push(k);
  return { y, no, airbags: Number.isFinite(airbags) ? airbags : null };
}

const fuelOf = (s) => ({ petrol: 'Petrol', diesel: 'Diesel', cng: 'CNG', electric: 'Electric', hybrid: 'Hybrid', 'strong hybrid': 'Hybrid', 'mild hybrid': 'Petrol', 'plug-in hybrid': 'Hybrid' }[String(s || '').toLowerCase()] || null);
// which Autocar variant is this car of ours? same fuel and gearbox, closest ex-showroom price, name as tie-breaker
const toks = (s) => new Set(String(s).toLowerCase().replace(/\(o\)/g, ' opt ').replace(/\+/g, ' plus ').split(/[^a-z0-9.]+/).filter(Boolean));
export function matchVariant(car, avs, single) {
  let best = null, bs = Infinity;
  const ct = toks(car.variant);
  for (const a of avs) {
    if (a.fuel && car.fuel && a.fuel !== car.fuel && !(car.fuel === 'Hybrid' && a.fuel === 'Petrol')) continue;
    if (a.tr && car.transmission && a.tr !== car.transmission) continue;
    const dp = a.p && car.price ? Math.abs(a.p - car.price) / car.price : 1;
    const at = toks(a.n); let common = 0; for (const t of ct) if (at.has(t)) common++;
    const sc = dp - 0.02 * common;
    if (sc < bs) { bs = sc; best = { a, dp }; }
  }
  if (!best) return null;
  if (best.dp <= 0.06 || single) return best.a;
  return null;
}

async function main() {
  const cars = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/cars.json'), 'utf8')).cars;
  const xp = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/expert.json'), 'utf8')).models || {}; } catch (e) { return {}; } })();
  const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { return { models: {} }; } })();
  const needs = (c) => c.fsrc === 'autocar' || !/[01]/.test(c.fs); // maker publishes no feature list for it
  const byModel = new Map();
  for (const c of cars) { const k = c.brand + '|' + c.model; if (!byModel.has(k)) byModel.set(k, []); byModel.get(k).push(c); }
  let keys = [...byModel.keys()].filter((k) => process.env.AF_ALL || byModel.get(k).some(needs));
  if (process.env.AF_ONLY) { const only = process.env.AF_ONLY.split(','); keys = keys.filter((k) => only.includes(k)); }
  if (process.env.AF_SLICE) { const [i, n] = process.env.AF_SLICE.split('/').map(Number); keys = keys.filter((k, j) => j % n === i); }
  const out = { source: 'Autocar India variant pages (autocarindia.com/cars/<make>/<model>/<variant>)', updated: new Date().toISOString(), models: { ...prev.models } };
  let pages = 0, filled = 0, failed = 0;
  for (const k of keys) {
    const [brand, model] = k.split('|');
    const slugs = [...new Set([SLUG[k], xp[k] && xp[k].slug, `${BRAND_SLUG[brand] || slugify(brand)}/${slugify(model)}`].filter(Boolean))];
    let list = null, slug = null;
    for (const s of slugs) {
      const h = await get(`${BASE}/cars/${s}/variants`);
      if (h === undefined) { failed++; break; }
      const vl = h && block(h, '"variant_list":[');
      if (vl && vl.length) { list = vl; slug = s; break; }
    }
    if (!list) { console.log('no variants on Autocar:', k); continue; }
    const avs = list.filter((v) => v.launch_stage !== 'upcoming').map((v) => ({ n: v.display_name, s: v.slug, fuel: fuelOf(v.fuel_type), tr: v.transmission_category === 'Manual' ? 'Manual' : v.transmission_category ? 'Automatic' : null, p: (v.price && v.price.ex_showroom_price) || null }));
    const ours = byModel.get(k).filter((c) => process.env.AF_ALL || needs(c));
    const single = ours.length === 1 && /starting/i.test(ours[0].variant);
    const want = new Map();
    for (const c of ours) {
      const a = single ? avs.slice().sort((x, y) => (x.p || 9e9) - (y.p || 9e9))[0] : matchVariant(c, avs, false);
      if (a) want.set(a.s, a);
    }
    const got = [];
    for (const a of want.values()) {
      const h = await get(`${BASE}/cars/${slug}/${a.s}`); pages++;
      if (!h) { if (h === undefined) failed++; continue; }
      const fi = h.indexOf('"features":{"description"'); const fb = fi < 0 ? null : block(h.slice(fi), '"features":{');
      if (!fb || !fb.data) continue;
      got.push({ ...a, ...mapFeatures(fb.data) });
      await sleep(250);
    }
    if (got.length) { out.models[k] = { slug, variants: got }; filled += ours.length; }
    console.log(`${k}: ${avs.length} on Autocar, ${ours.length} ours, ${got.length} variant pages read`);
  }
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`done: ${keys.length} models, ${pages} variant pages, failures ${failed}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();
