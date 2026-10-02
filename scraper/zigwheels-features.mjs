// Fills feature gaps (anything still unknown after the maker's site and Autocar India) from ZigWheels
// variant pages, e.g. https://www.zigwheels.com/mahindra-cars/thar-og/1.5l-axt-diesel-rwd
// Also picks up Bharat NCAP / Global NCAP star ratings for models we have no crash-test data for.
// Writes data/zigwheels-features.json: { updated, models: { "Brand|Model": { slug, ncap?, variants: [{ n, s, fuel, tr, p, y: [keys], no: [keys], airbags }] } } }
// Usage: node scraper/zigwheels-features.mjs   (env: ZW_ONLY="Brand|Model,…", ZW_SLICE="i/n", ZW_CONC=4)
import fs from 'fs';
import path from 'path';
import { matchVariant } from './autocar-features.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'data/zigwheels-features.json');
const BASE = 'https://www.zigwheels.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
// our model → ZigWheels "brand-cars/model" path, when it isn't the obvious one
const SLUG = {
  'Land Rover|Defender 110': 'land-rover-cars/defender', 'Land Rover|Defender 90': 'land-rover-cars/defender', 'Land Rover|Defender 130': 'land-rover-cars/defender',
  'Maruti Suzuki|WagonR': 'maruti-suzuki-cars/wagon-r', 'MG|Windsor Pro': 'mg-motor-cars/windsor-ev', 'MG|Hector Plus 6 Seater': 'mg-motor-cars/hector-plus',
  'Toyota|Land Cruiser 300': 'toyota-cars/land-cruiser-300', 'Mahindra|Scorpio-N': 'mahindra-cars/scorpio-n',
};
const BRAND = { MG: 'mg-motor' };
const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en-IN' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      if (r.status === 404 || r.status === 410) return null;
      if (r.ok) return { html: await r.text(), url: r.url };
    } catch (e) {}
    await sleep(1500 * (i + 1));
  }
  return undefined;
}
const unent = (s) => s.replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const text = (h) => unent(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// spec / feature table: label → value
function rows(h) {
  const out = {};
  const parts = h.split('<td class="label-spec">').slice(1);
  for (const p of parts) {
    const lab = (p.match(/<span[^>]*>([\s\S]*?)<\/span>/) || [])[1];
    if (!lab) continue;
    const vi = p.indexOf('value-spec'); if (vi < 0) continue;
    let v = p.slice(p.indexOf('>', vi) + 1);
    v = v.split(/<\/tr>|<span class="ro-popup/)[0];
    const l = text(lab), val = text(v);
    if (l && !(l in out)) out[l] = val;
  }
  return out;
}
// variant list on a model page
function variantList(h, base) {
  const out = [], seen = new Set();
  for (const tr of h.split(/<tr data-Tvariant=/i).slice(1)) {
    let a = tr.match(new RegExp(`href="(?:${BASE})?/${base}/([a-z0-9.\\-]+)"[^>]*title="([^"]*)"`, 'i'));
    if (!a) { // single-variant models have no link: derive the variant slug from the compare id ("kia-carnival-limousine-plus")
      const c = tr.match(/data-cmp-url="([^"]+)"[^>]*title="([^"]*)"/);
      const [bp, mp] = base.split('/'); const pre = [`${bp.replace(/-cars$/, '')}-${mp}-`, `${bp.split('-')[0]}-${mp}-`].find((x) => c && c[1].startsWith(x));
      if (c && pre) a = [null, c[1].slice(pre.length), c[2]];
    }
    if (!a || seen.has(a[1])) continue;
    const row = text(tr.split('</tr>')[0]);
    const pm = row.match(/Rs\.?\s*([\d.,]+)\s*(Lakh|Crore|Cr)/i);
    const fm = row.match(/\b(Petrol|Diesel|CNG|Electric|Hybrid)\b/i);
    const tm = row.match(/\b(Manual|Automatic)\b/i);
    seen.add(a[1]);
    out.push({ n: unent(a[2]), s: a[1], p: pm ? Math.round(parseFloat(pm[1].replace(/,/g, '')) * (/cr/i.test(pm[2]) ? 1e7 : 1e5)) : null, fuel: fm ? fm[1][0].toUpperCase() + fm[1].slice(1).toLowerCase() : null, tr: tm ? (tm[1].toLowerCase() === 'manual' ? 'Manual' : 'Automatic') : null });
  }
  return out;
}

// value → true / false / undefined
const on = (v) => {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s || /^optional/i.test(s)) return undefined;
  if (/^(no|none|na|n\/a|-|not available.*)$/i.test(s)) return false;
  return true;
};
const anyOf = (...vals) => (vals.some((v) => on(v) === true) ? true : vals.some((v) => on(v) === false) ? false : undefined);
const re = (rx, v, ifNoMatch = false) => (on(v) === undefined ? undefined : on(v) ? (rx.test(v) ? true : ifNoMatch) : false);
function mapFeatures(R) {
  const g = (...ls) => { for (const l of ls) if (l in R) return R[l]; return undefined; };
  const ab = parseInt(g('No of Airbags', 'No Of Airbags'), 10);
  const ent = `${g('Additional Entertainment Features') || ''} ${g('Connectivity') || ''} ${g('Additional Features') || ''}`;
  const brakesRear = g('Brakes Rear');
  const f = {
    airbags6: Number.isFinite(ab) ? ab >= 6 : undefined,
    abs: on(g('Anti-lock Braking System (ABS)', 'Anti-Lock Braking System (ABS)')),
    esc: on(g('Eletronic Stability Control (ESC)', 'Electronic Stability Control (ESC)')),
    hillAssist: on(g('Hill Assist')),
    hillDescent: on(g('Hill Descent Control')),
    tpms: on(g('Tyre Pressure Monitoring System (TPMS)', 'Tyre Pressure Monitor')),
    isofix: on(g('ISOFIX Child Seat Mounts')),
    rearCamera: on(g('Rear Camera')),
    camera360: on(g('360 View Camera')),
    rearSensors: re(/rear/i, g('Parking Sensors')),
    frontSensors: re(/front/i, g('Parking Sensors')),
    adas: anyOf(g('Automatic Emergency Braking'), g('Lane Keep Assist'), g('Adaptive Cruise Control'), g('Forward Collision Warning')),
    blindSpot: on(g('Blind Spot Monitor', 'Blind Spot Camera')),
    rearDisc: brakesRear == null ? undefined : /disc/i.test(brakesRear) ? true : /drum/i.test(brakesRear) ? false : undefined,
    touchscreen: anyOf(g('Touchscreen'), g('Touch-screen Display')),
    androidAuto: anyOf(g('Android Auto'), g('Apple CarPlay')),
    wirelessAA: /wireless\s*(android|apple|carplay)/i.test(ent) ? true : undefined,
    connected: anyOf(g('In Car Remote Control App'), g('Remote Vehicle Status Check'), g('Live Location'), g('Real Time Vehicle Tracking')),
    digitalCluster: (() => { const v = g('Digital Cluster'); if (on(v) === undefined) return undefined; return on(v) && !/analog/i.test(v); })(),
    wirelessCharger: on(g('Wireless Phone Charging')),
    premiumAudio: /harman|bose|jbl|sony|infinity|bang|burmester|meridian|marantz|arkamys|krell|bowers|dynaudio|premium sound/i.test(ent) ? true : undefined,
    hud: on(g('Heads-Up Display (HUD)', 'Head Up Display')),
    voiceCommands: on(g('Voice Commands')),
    autoClimate: on(g('Automatic Climate Control')),
    dualZone: (() => { const v = g('Automatic Climate Control'); if (on(v) === undefined) return undefined; const m = String(v).match(/(\d)\s*zone/i); return m ? +m[1] >= 2 : /dual/i.test(v) ? true : undefined; })(),
    rearAC: anyOf(g('Rear ACVents'), g('Rear AC Vents'), g('Rear AC Ducts')),
    cruise: anyOf(g('Cruise Control'), g('Adaptive Cruise Control')),
    keyless: anyOf(g('Keyless Entry'), g('Smart Entry')),
    pushStart: anyOf(g('Engine Start Stop Button'), g('Push Ignition')),
    poweredSeat: on(g('Powered Seats', 'Power Adjustable Driver Seat')),
    ventilated: on(g('Ventilated Seats')),
    autoHeadlamps: on(g('Automatic Headlamps')),
    rainWipers: anyOf(g('Rain Sensing Wiper'), g('Auto Rain Sensing Wipers')),
    foldingORVM: on(g('Electric Folding Rear View Mirror')),
    epb: on(g('Electronic Parking Brake', 'Electric Parking Brake')),
    paddleShifters: on(g('Paddle Shifters')),
    driveModes: on(g('Drive Modes')),
    rearArmrest: on(g('Rear Seat Centre Arm Rest')),
    tiltTelescopic: re(/telescopic/i, g('Steering Column')),
    powerTailgate: anyOf(g('Hands Free Tailgate'), g('Powered Tailgate')),
    sunroof: on(g('Sun Roof', 'Sunroof', 'Sunroof / Moonroof')),
    panoramic: re(/panoramic|dual.?pane/i, g('Sun Roof', 'Sunroof')),
    dashcam: on(g('Dash Cam', 'Dashcam')),
    ambient: anyOf(g('Ambient Light Colour'), g('Ambient Lighting')),
    leather: re(/leather/i, g('Upholstery')),
    airPurifier: on(g('Air Purifier')),
    massage: on(g('Massage Seats')),
    ledHeadlamps: on(g('LED Headlamps')),
    ledDRL: on(g('LED DRLs')),
    alloys: on(g('Alloy Wheels')),
    fogLamps: on(g('LED Fog Lamps', 'Fog Lights Front', 'Front Fog Lamps')) === true ? true : undefined,
    roofRails: on(g('Roof Rails')),
  };
  const y = [], no = [];
  for (const [k, val] of Object.entries(f)) if (val === true) y.push(k); else if (val === false) no.push(k);
  return { y, no, airbags: Number.isFinite(ab) ? ab : null };
}
function ncapOf(R) {
  const st = (v) => { const m = String(v || '').match(/(\d)\s*Star/i); return m ? +m[1] : null; };
  const b = st(R['Bharat NCAP Safety Rating']), bc = st(R['Bharat NCAP Child Safety Rating']);
  if (b) return { stars: b, child: bc || undefined, by: 'Bharat NCAP' };
  const gl = st(R['Global NCAP Safety Rating']), gc = st(R['Global NCAP Child Safety Rating']);
  if (gl) return { stars: gl, child: gc || undefined, by: 'Global NCAP' };
  return null;
}

async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const j = i++; await fn(items[j], j); } })); }

async function main() {
  const cars = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/cars.json'), 'utf8')).cars;
  const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { return { models: {} }; } })();
  const byModel = new Map();
  for (const c of cars) { const k = c.brand + '|' + c.model; if (!byModel.has(k)) byModel.set(k, []); byModel.get(k).push(c); }
  let keys = [...byModel.keys()];
  if (process.env.ZW_ONLY) { const only = process.env.ZW_ONLY.split(','); keys = keys.filter((k) => only.includes(k)); }
  if (process.env.ZW_SLICE) { const [i, n] = process.env.ZW_SLICE.split('/').map(Number); keys = keys.filter((k, j) => j % n === i); }
  const out = { source: 'ZigWheels variant pages (zigwheels.com/<brand>-cars/<model>/<variant>)', updated: new Date().toISOString(), models: { ...prev.models } };
  let pages = 0, failed = 0;
  await pool(keys, Number(process.env.ZW_CONC || 4), async (k) => {
    const [brand, model] = k.split('|');
    const cands = [...new Set([SLUG[k], `${BRAND[brand] || slugify(brand)}-cars/${slugify(model)}`, `${BRAND[brand] || slugify(brand)}-cars/${slugify(model).replace(/\./g, '')}`, `${BRAND[brand] || slugify(brand)}-cars/${slugify(model.replace(/\s+(EV|Lwb|LWB)$/i, ''))}`].filter(Boolean))];
    let list = null, base = null;
    for (const c of cands) {
      const r = await get(`${BASE}/${c}`);
      if (r === undefined) { failed++; return; }
      if (!r) continue;
      const realBase = (r.url.replace(BASE + '/', '').match(/^[a-z0-9-]+-cars\/[a-z0-9.\-]+/) || [c])[0];
      const vl = variantList(r.html, realBase);
      if (vl.length) { list = vl; base = realBase; break; }
    }
    if (!list) { console.log('not on ZigWheels:', k); return; }
    const ours = byModel.get(k);
    const want = new Map();
    const single = ours.length === 1 && /starting|from/i.test(ours[0].variant);
    for (const c of ours) {
      const a = single ? list.slice().sort((x, y) => (x.p || 9e18) - (y.p || 9e18))[0] : matchVariant(c, list, false);
      if (a) want.set(a.s, a);
    }
    const got = []; let ncap = null;
    for (const a of want.values()) {
      const r = await get(`${BASE}/${base}/${a.s}`); pages++;
      if (!r) { if (r === undefined) failed++; continue; }
      const R = rows(r.html);
      if (!Object.keys(R).length) continue;
      got.push({ ...a, ...mapFeatures(R) });
      ncap = ncap || ncapOf(R);
    }
    if (got.length) out.models[k] = { slug: base, ncap: ncap || undefined, variants: got };
    console.log(`${k}: ${list.length} on ZigWheels, ${ours.length} ours, ${got.length} pages read${ncap ? `, ${ncap.by} ${ncap.stars}★` : ''}`);
  });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`done: ${keys.length} models, ${pages} variant pages, failures ${failed}`);
}
main();
