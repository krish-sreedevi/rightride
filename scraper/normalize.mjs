// Turns data/raw/*.json (+ data/curated/*.json) into site/data/cars.json
// Canonical feature catalogue, grouped into buckets for the filter UI.
import fs from 'fs';
import path from 'path';
import { matchVariant } from './autocar-features.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// ---------- feature catalogue ----------
// key: [bucket, label, regex on raw feature label (and value text), optional exclude regex]
export const FEATURES = {
  // Safety
  airbags6: ['Safety', '6+ airbags', null],
  abs: ['Safety', 'ABS with EBD', /\babs\b|anti-?lock/i],
  esc: ['Safety', 'Electronic stability control (ESC/ESP)', /\b(esc|esp|vsc|vdc)\b|electronic stability|stability (control|program)/i],
  hillAssist: ['Safety', 'Hill start assist', /hill[\s-]*(start|hold|assist|launch)/i, /descent/i],
  hillDescent: ['Safety', 'Hill descent control', /hill[\s-]*descent/i],
  tpms: ['Safety', 'Tyre pressure monitor (TPMS)', /tpms|tyre pressure|tire pressure/i],
  isofix: ['Safety', 'ISOFIX child seat mounts', /isofix|iso-fix|iso fix/i],
  rearCamera: ['Safety', 'Rear parking camera', /(rear|reverse|reversing|back)[\w\s-]*(camera|cam)|parking camera|camera with/i, /360|surround|dash/i],
  rearSensors: ['Safety', 'Rear parking sensors', /(rear|reverse)[\w\s]*parking sensor|parking sensors?\s*\(?rear|rear sensors/i],
  frontSensors: ['Safety', 'Front parking sensors', /front[\w\s]*parking sensor|parking sensors?\s*\(?front|front sensors/i],
  adas: ['Safety', 'ADAS (auto emergency braking, lane assist)', /\badas\b|autonomous emergency brak|\baeb\b|forward collision|lane keep|lane departure|smartsense|level[\s-]*2|honda sensing|toyota safety sense/i],
  blindSpot: ['Safety', 'Blind spot monitor/camera', /blind[\s-]*(spot|view)|lane ?watch/i],
  rearDisc: ['Safety', 'Rear disc brakes', /rear disc|all[\s-]*(4|four)[\s-]*(wheel)?[\s-]*disc|disc brakes? \(all|4 disc/i],
  // Tech & connectivity
  touchscreen: ['Tech & Connectivity', 'Touchscreen infotainment', /touch\s*screen|touchscreen|infotainment (system|screen)|display audio|smartplay/i],
  androidAuto: ['Tech & Connectivity', 'Android Auto / Apple CarPlay', /android auto|apple car\s*play|smartphone (replication|connectivity|integration)|smartphone mirroring/i],
  wirelessAA: ['Tech & Connectivity', 'Wireless Android Auto / CarPlay', /wireless[\w\s/]*(android|apple|car\s*play|smartphone)/i],
  connected: ['Tech & Connectivity', 'Connected car tech (app control)', /connected (car|vehicle|technology)|bluelink|kia connect|suzuki connect|i-?connect|\bira\b|adrenox|bluesense|i-smart|nissan ?connect|mycar|connect(ed)? app|telematics|honda connect|mylink/i],
  digitalCluster: ['Tech & Connectivity', 'Digital instrument cluster', /digital (instrument|driver|cockpit|cluster|display)|fully digital|full[\s-]*digital|tft (instrument|cluster|display)|virtual cockpit|lcd cluster|instrument cluster.*(tft|digital|lcd)/i],
  wirelessCharger: ['Tech & Connectivity', 'Wireless phone charger', /wireless (phone )?charg|qi charg|wireless mobile charg/i],
  premiumAudio: ['Tech & Connectivity', 'Premium sound system', /\b(bose|jbl|harman|sony|infinity|arkamys|burmester|bang|b&o|meridian|dolby|premium (sound|audio))\b/i],
  hud: ['Tech & Connectivity', 'Head-up display', /head[\s-]*up display|\bhud\b/i],
  voiceCommands: ['Tech & Connectivity', 'Voice commands', /voice (command|assist|control|recognition)|alexa|hey /i],
  // Comfort & convenience
  autoClimate: ['Comfort & Convenience', 'Automatic climate control', /auto(matic)?[\s-]*(climate|ac\b|a\/c|air[\s-]*con)|climate control|fatc/i, /manual/i],
  dualZone: ['Comfort & Convenience', 'Dual-zone climate', /dual[\s-]*zone|2[\s-]*zone|tri[\s-]*zone|three[\s-]*zone/i],
  rearAC: ['Comfort & Convenience', 'Rear AC vents', /rear (ac|a\/c|air[\s-]*con|aircon)|rear (seat )?vents|air vents? .*rear|2nd row (ac|vents)/i],
  cruise: ['Comfort & Convenience', 'Cruise control', /cruise/i],
  keyless: ['Comfort & Convenience', 'Keyless entry', /keyless|smart (key|entry|access)|passive entry|remote (keyless|central)/i],
  pushStart: ['Comfort & Convenience', 'Push-button start', /push[\s-]*(button|start)|start[\s/-]*stop button|engine start/i, /idle/i],
  poweredSeat: ['Comfort & Convenience', 'Powered driver seat', /(power(ed)?|electric(al(ly)?)?)[\w\s-]*(adjust\w*)?[\w\s-]*driver('?s)? seat|driver seat[\w\s-]*(power|electric)|\d+[\s-]*way (power|electric)/i],
  ventilated: ['Comfort & Convenience', 'Ventilated front seats', /ventilat\w* seat|cooled seat|seat ventilation|ventilated (front|driver)/i],
  autoHeadlamps: ['Comfort & Convenience', 'Auto headlamps', /auto(matic)?[\s-]*(head\s*lamp|head\s*light|light control)|light sensor|dusk sensing/i],
  rainWipers: ['Comfort & Convenience', 'Rain-sensing wipers', /rain[\s-]*sens/i],
  autoIRVM: ['Comfort & Convenience', 'Auto-dimming mirror', /(auto|electro)[\s-]*(dimming|chromic)|ec irvm|e\.c\. irvm/i],
  foldingORVM: ['Comfort & Convenience', 'Electrically folding mirrors', /(electric|power|auto)[\w\s-]*fold/i],
  epb: ['Comfort & Convenience', 'Electronic parking brake / auto hold', /electronic parking brake|electric parking brake|\bepb\b|auto[\s-]*hold/i],
  paddleShifters: ['Comfort & Convenience', 'Paddle shifters', /paddle/i],
  driveModes: ['Comfort & Convenience', 'Drive modes', /drive mode|driving mode|terrain mode|traction mode|eco\s*\/\s*normal|multi[\s-]*drive/i],
  rearArmrest: ['Comfort & Convenience', 'Rear centre armrest', /rear[\w\s]*arm\s*rest/i],
  tiltTelescopic: ['Comfort & Convenience', 'Tilt & telescopic steering', /telescopic/i],
  powerTailgate: ['Comfort & Convenience', 'Powered tailgate', /power(ed)? (tail\s*gate|boot|back door)|electric (tail\s*gate|boot)|hands[\s-]*free (tail|boot)|smart (power )?tail\s*gate/i, /release|opener|open(ing)? switch/i],
  // Premium / "fancy"
  sunroof: ['Premium & Fancy', 'Sunroof (any)', /sun\s*roof|moon\s*roof|sky\s*roof|glass roof/i],
  panoramic: ['Premium & Fancy', 'Panoramic sunroof', /panoram|sky\s*roof|skyroof|infinity roof/i],
  camera360: ['Premium & Fancy', '360° camera', /360|surround view|around view|panoramic view monitor/i, /360\s*(view)?\s*(showroom|spin)/i],
  dashcam: ['Premium & Fancy', 'Built-in dashcam', /dash\s*cam|dashboard camera|dual camera recorder|\bdvr\b/i],
  ambient: ['Premium & Fancy', 'Ambient lighting', /ambient|mood light|mood lamp/i, /sound|meter/i],
  leather: ['Premium & Fancy', 'Leather / leatherette seats', /leather|leatherette|artificial leather|vegan leather|napa|nappa/i, /steering|gear|knob|wrapped|door (trim|pad)|armrest/i],
  airPurifier: ['Premium & Fancy', 'Air purifier', /air purifier|air cleaner|pm\s*2\.5|ionizer|nanoe/i, /filter/i],
  massage: ['Premium & Fancy', 'Massage seats', /massag/i],
  captainSeats: ['Premium & Fancy', 'Captain seats (2nd row)', /captain/i],
  // Exterior & lighting
  ledHeadlamps: ['Exterior & Lighting', 'LED headlamps', /led[\w\s-]*(head\s*lamp|head\s*light|projector)|(head\s*lamp|head\s*light)[\w\s-]*led|matrix led|bi-led/i, /halogen/i],
  ledDRL: ['Exterior & Lighting', 'LED DRLs', /drl|daytime running/i],
  alloys: ['Exterior & Lighting', 'Alloy wheels', /alloy/i],
  fogLamps: ['Exterior & Lighting', 'Fog lamps', /fog/i],
  roofRails: ['Exterior & Lighting', 'Roof rails', /roof rail/i],
};

export const BUCKETS = ['Safety', 'Tech & Connectivity', 'Comfort & Convenience', 'Premium & Fancy', 'Exterior & Lighting'];

// brands whose feature lists are complete per variant (absent => false); others => unknown
const COMPLETE = new Set(['Hyundai', 'Tata', 'Maruti Suzuki', 'Honda', 'MG']);

const NEG = /^(no|n|-|–|—|na|n\/a|not available|nil|x|✗|✕|none|0|false|not applicable|optional|o|opt|\(o\))$/i;
function truthy(value) {
  const v = String(value ?? '').trim();
  if (!v) return false;
  if (NEG.test(v)) return false;
  if (/^(yes|y|s|std|standard|●|•|✓|✔|available|true)$/i.test(v)) return true;
  if (/not available|not offered|^no\b/i.test(v)) return false;
  return true; // descriptive text => present
}

function parseAirbags(features) {
  let n = 0;
  for (const f of features) {
    const t = `${f.label} ${f.value}`;
    const isBag = /airbag|srs/i.test(t) || (/curtain/i.test(f.label) && !/air curtain/i.test(f.label));
    if (!isBag || !truthy(f.value)) continue;
    const m = t.match(/(\d+)\s*(\(.*?\))?\s*airbags?/i) || t.match(/airbags?\s*[:=-]?\s*(\d+)/i);
    if (m) n = Math.max(n, Number(m[1]));
    else if (/curtain/i.test(t)) n = Math.max(n, 6);
    else if (/side/i.test(t)) n = Math.max(n, 4);
    else if (/knee/i.test(t)) n = Math.max(n, 2);
    else if (/driver|passenger|dual|front/i.test(t)) n = Math.max(n, 2);
  }
  return n || null;
}

function mapFeatures(features, complete) {
  const out = {};
  for (const [key, [, , re, ex]] of Object.entries(FEATURES)) {
    if (!re) continue;
    let hit = null;
    for (const f of features) {
      const text = `${f.label} ${/^(yes|no|s|-|●|na)$/i.test(f.value || '') ? '' : f.value || ''}`;
      if (!re.test(text) || (ex && ex.test(f.label))) continue;
      const t = truthy(f.value);
      hit = hit === true ? true : t;
      if (t) break;
    }
    out[key] = hit === null ? (complete ? false : null) : hit;
  }
  // implications
  if (out.panoramic) out.sunroof = true;
  if (out.wirelessAA) out.androidAuto = true;
  if (out.dualZone) out.autoClimate = true;
  const ab = parseAirbags(features);
  out.airbags6 = ab == null ? (complete ? false : null) : ab >= 6;
  return { f: out, airbags: ab };
}

// ---------- powertrain & basics ----------
function normFuel(s, name = '') {
  const t = `${s} ${name}`.toLowerCase();
  if (/phev|plug-?in/.test(t)) return 'PHEV';
  if (/e:?hev|hybrid|e-power|self[\s-]*charging|strong hybrid/.test(t)) return 'Hybrid';
  if (/electr|\bev\b|kwh|\bbev\b/.test(t)) return 'Electric';
  if (/cng/.test(t)) return 'CNG';
  if (/diesel|\bdsl\b|crdi|tdi|mhawk|\bd\d{3}\b/.test(t)) return 'Diesel';
  return 'Petrol';
}
function normTrans(s, name = '', fuel = '') {
  const t = `${s} ${name}`.toUpperCase();
  let type = null;
  if (/\bAMT\b|AGS|EZ-?SHIFT|\bBVR/.test(t)) type = 'AMT';
  else if (/\bDCT\b|\bDSG\b|DCA|DUAL[\s-]*CLUTCH/.test(t)) type = 'DCT';
  else if (/E-?CVT/.test(t)) type = 'e-CVT';
  else if (/\bCVT\b|\bIVT\b/.test(t)) type = 'CVT';
  else if (/\bAT\b|AUTOMATIC|\bTC\b|TORQUE CONVERTER|\(A\)|AUTM/.test(t)) type = 'AT';
  else if (/\bMT\b|MANUAL|MANL/.test(t)) type = 'MT';
  if (!type && (fuel === 'Electric' || fuel === 'Hybrid')) type = 'AT';
  return { transmission: type === 'MT' ? 'Manual' : type ? 'Automatic' : null, transType: type };
}

const BODY_RULES = [
  [/sedan|dzire|aura|verna|city|amaze|slavia|virtus|ciaz|tigor|camry|superb|octavia|c-class|e-class|s-class|a4\b|a6\b|a8\b|3 series|5 series|7 series|i4\b|i5\b|i7\b|\bxf\b|\bcla\b/i, 'Sedan'],
  [/ertiga|xl6|carens|clavis|innova|hycross|crysta|rumion|triber|invicto|carnival|marazzo|v-class|vellfire|gravite/i, 'MUV / MPV'],
  [/alto|wagon ?r|celerio|s-?presso|swift|baleno|ignis|glanza|i10|nios|i20|tiago|altroz|kwid|comet|eeco|a-class/i, 'Hatchback'],
  [/hilux|pickup|pik-?up|v-cross/i, 'Pickup'],
  [/amg gt|\bcle\b|coupe|coupé|z4|m4|m8|911|f-type|sl\b|cabriolet|roadster|gt\b/i, 'Coupe / Convertible'],
];
function bodyOf(brand, model, given) {
  if (given && /suv|sedan|hatch|muv|mpv|coupe|pickup/i.test(given)) {
    const g = given.toLowerCase();
    return g.includes('suv') ? 'SUV' : g.includes('sedan') ? 'Sedan' : g.includes('hatch') ? 'Hatchback' : g.includes('pick') ? 'Pickup' : g.includes('coupe') ? 'Coupe / Convertible' : 'MUV / MPV';
  }
  for (const [re, b] of BODY_RULES) if (re.test(model)) return b;
  return 'SUV';
}

function RR_variant(name, model, rawModel) {
  let s = String(name);
  for (const m of new Set([model, rawModel, rawModel.replace(/^(all[\s-]+)?new\s+/i, '')])) {
    if (!m) continue;
    s = s.replace(new RegExp('(^|\\s)' + m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$)', 'ig'), ' ');
  }
  s = s.replace(/,\s*(petrol|diesel|bi-fuel cng|cng|petrol\/ethanol|electric)\s*$/i, '').replace(/\s+/g, ' ').trim();
  return s || name;
}

function num(s) { const m = String(s ?? '').replace(/,/g, '').match(/\d+(\.\d+)?/); return m ? Number(m[0]) : null; }

function specOf(specs, re) { for (const [k, v] of Object.entries(specs || {})) if (re.test(k)) return v; return null; }

function cleanModelName(brand, m) {
  let s = String(m).replace(/^(all[\s-]+)?new\s+/i, '').replace(/^the\s+/i, '').replace(/^(volkswagen|vw|kia|nissan|renault|tata|hyundai|honda|skoda|škoda|mg|toyota|mahindra|jeep|audi|bmw|mercedes-benz)\s+/i, '').trim();
  if (brand === 'Volkswagen') s = s.replace(/\s+(anniversary edition|chrome|sport)$/i, '');
  if (brand === 'Mahindra') s = s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bXuv\b/g, 'XUV').replace(/\b(\d)xo\b/i, '$1XO').replace(/Og$/, 'OG').replace(/\bBe\b/g, 'BE').replace(/\bXev\b/g, 'XEV').replace(/\b9s\b/g, '9S').replace(/\bEv\b/g, 'EV');
  const KEEP = /^(IONIQ|XEV|XUV\d*|XUV|CNG|EV\d*|GT|RS|ZS|AMG|GLA|GLC|GLE|GLS|CLA|CLE|EQS|EQA|EQB|EQE|XL6|SUV|MPV|OG|N|TSI|TDI)$/;
  s = s.split(/\s+/).map((w) => (/^[A-Z]{3,}$/.test(w) && !KEEP.test(w) ? w[0] + w.slice(1).toLowerCase() : w)).join(' ');
  s = s.replace(/\bEv\b/g, 'EV').replace(/\bXuv(\d*)\b/g, 'XUV$1').replace(/\bPhev\b/g, 'PHEV').replace(/^E Vitara$/i, 'e Vitara').replace(/\bNios\b/, 'Nios');
  return s;
}

// keep model names stable between the live scrape and older snapshots (images, reviews and NCAP are keyed by name)
const MODEL_ALIAS = {
  BMW: { '3 Lwb': '3 Series Lwb', '5 Lwb': '5 Series Lwb', '2 Series': '2 Series Gran Coupe' },
  'Mercedes-Benz': { 'A-Class Hatchback': 'A-Class', 'CLE Coupé': 'CLE Coupe', 'GLC Coupé': 'GLC Coupe', 'GLE Coupé': 'GLE Coupe', 'E-Class Sedan': 'E-Class', 'E-Class Sedan Long': 'E-Class', 'Mercedes AMG GT Coupé': 'AMG GT Coupe', 'AMG GT Coupé': 'AMG GT Coupe', 'Mercedes-Maybach EQS SUV': 'Maybach EQS SUV', 'Mercedes-Maybach GLS': 'Maybach GLS', 'Mercedes-Maybach SL Monogram Series': 'Maybach SL', 'Mercedes-Maybach S-Class': 'Maybach S-Class' },
};
// no longer sold new in India (makers' price feeds can lag behind)
const GONE = new Set(['Maruti Suzuki|Ciaz', 'Maruti Suzuki|Ignis', 'Skoda|Kodiaq RS']);
function modelName(brand, m) {
  let s = cleanModelName(brand, m.model);
  if (brand === 'Mercedes-Benz' && s === 'EQS' && /\/suv\//.test(m.url || '')) s = 'EQS SUV';
  return (MODEL_ALIAS[brand] || {})[s] || s;
}

export function normalize() {
  const rawDir = path.join(ROOT, 'data/raw');
  const curDir = path.join(ROOT, 'data/curated');
  const rawFiles = fs.existsSync(rawDir) ? fs.readdirSync(rawDir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).map((f) => path.join(rawDir, f)) : [];
  const rawNames = new Set(rawFiles.map((f) => path.basename(f)));
  // a curated snapshot (data/curated/x.json) is only used when the scraper for x produced nothing
  const curAll = fs.existsSync(curDir) ? fs.readdirSync(curDir).filter((f) => f.endsWith('.json')).map((f) => path.join(curDir, f)) : [];
  const curFiles = curAll.filter((f) => !rawNames.has(path.basename(f)));
  // when the scraper did produce the brand, its snapshot still fills in models the scrape missed
  // data/curated-extra/*.json: models the brand scrapers don't cover (new brands live in data/curated);
  // a model there is used only if no scraper or snapshot already produced it
  const extraDir = path.join(ROOT, 'data/curated-extra');
  const extraFiles = [...curAll.filter((f) => rawNames.has(path.basename(f))), ...(fs.existsSync(extraDir) ? fs.readdirSync(extraDir).filter((f) => f.endsWith('.json')).map((f) => path.join(extraDir, f)) : [])];
  const files = [...rawFiles, ...curFiles, ...extraFiles];
  const haveModel = new Set();
  const cars = [];
  const brands = {};
  const seen = new Set();
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const brand = raw.brand;
    const complete = raw.complete ?? COMPLETE.has(brand);
    brands[brand] = brands[brand] || { brand, updated: raw.scrapedAt || raw.updated, source: raw.source, curated: !!raw.curated, models: 0, variants: 0 };
    const isExtra = extraFiles.includes(file);
    for (const m of raw.models || []) {
      const model = modelName(brand, m);
      if (isExtra && haveModel.has(brand + '|' + model)) continue;
      if (GONE.has(brand + '|' + model)) continue;
      let nV = 0;
      for (const v of m.variants || []) {
        if (!v.price || v.price < 200000) continue;
        if (/ambulance|taxi|fleet|\bcsd\b/i.test(v.name)) continue;
        const fuel = normFuel(v.fuel, `${v.name} ${m.model}`);
        const { transmission, transType } = normTrans(v.transmission, v.name, fuel);
        const { f, airbags } = mapFeatures(v.features || [], complete && (v.features || []).length > 0);
        if (v.featureFlags) Object.assign(f, v.featureFlags); // curated / pre-mapped
        const specs = v.specs || {};
        const sn = `${v.name} ${m.model}`.match(/\b([4-9])\s*-?\s*(s|str|seater|seats?)\b|\[([4-9])s\]|\(([4-9])s\)/i);
        const seats = (sn && Number(sn[1] || sn[3] || sn[4])) || v.seats || num(specOf(specs, /seat(ing)? capacity|seats/i)) || (m.seats ?? null);
        const id = `${brand}|${model}|${v.name}|${fuel}|${transType}`.toLowerCase().replace(/[^a-z0-9|+]+/g, '-');
        if (seen.has(id)) continue; seen.add(id);
        const prices = {};
        for (const [k, p] of Object.entries(v.prices || {})) if (p && Math.abs(p - v.price) / v.price < 0.25) prices[k] = Math.round(p);
        cars.push({
          id, brand, model, variant: RR_variant(v.name, model, m.model),
          body: bodyOf(brand, model, m.body || v.body), fuel, transmission, transType,
          drive: /awd|4x4|4wd|quattro|xdrive|4matic|4motion/i.test(`${v.name} ${v.drive || ''} ${m.model}`) ? 'AWD/4x4' : '2WD',
          seats: seats ? Math.round(seats) : null,
          price: Math.round(v.price), prices, priceCity: v.priceCity || 'Delhi',
          cc: num(v.engine && /cc|\d{3,4}/.test(v.engine) ? v.engine : specOf(specs, /displacement|engine capacity|cubic/i)),
          mileage: num(v.mileage || specOf(specs, /fuel efficiency|mileage|arai|km\/l/i)) || null,
          range: fuel === 'Electric' ? num(specOf(specs, /range|mid[c]?/i)) : null,
          airbags: airbags ?? v.airbags ?? null, f, featureCount: (v.features || []).length || (v.featureFlags ? Object.values(v.featureFlags).filter(Boolean).length : 0),
          url: m.url, image: v.image || m.image || null,
          src: raw.curated ? 'curated' : 'official',
        });
        nV++;
      }
      if (nV) { if (!haveModel.has(brand + '|' + model)) brands[brand].models++; brands[brand].variants += nV; haveModel.add(brand + '|' + model); }
    }
  }
  // fill unknown seats from same model
  const seatsByModel = {};
  for (const c of cars) if (c.seats) seatsByModel[c.brand + c.model] = seatsByModel[c.brand + c.model] || c.seats;
  for (const c of cars) if (!c.seats) c.seats = seatsByModel[c.brand + c.model] || (c.body === 'MUV / MPV' ? 7 : 5);
  cars.sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model) || a.price - b.price);
  const keys = Object.keys(FEATURES);
  const featureMeta = keys.map((k) => ({ key: k, bucket: FEATURES[k][0], label: FEATURES[k][1] }));
  // compact: one char per feature, '1' yes, '0' no, '?' unknown
  // fill features the maker doesn't publish from Autocar India's variant pages (data/autocar-features.json)
  const AF = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/autocar-features.json'), 'utf8')).models || {}; } catch (e) { return {}; } })();
  const afByModel = {};
  for (const c of cars) (afByModel[c.brand + '|' + c.model] = afByModel[c.brand + '|' + c.model] || []).push(c);
  let afFilled = 0;
  for (const [k, list] of Object.entries(afByModel)) {
    const m = AF[k]; if (!m) continue;
    const todo = list.filter((c) => !Object.values(c.f).some((v) => v === true || v === false));
    const single = todo.length === 1 && list.length === 1 && /starting/i.test(todo[0].variant);
    for (const c of todo) {
      const a = single ? m.variants.slice().sort((x, y) => (x.p || 9e9) - (y.p || 9e9))[0] : matchVariant(c, m.variants, false);
      if (!a) continue;
      for (const kk of a.y) if (c.f[kk] == null) c.f[kk] = true;
      for (const kk of a.no) if (c.f[kk] == null) c.f[kk] = false;
      if (c.airbags == null && a.airbags) c.airbags = a.airbags;
      c.fsrc = 'autocar'; afFilled++;
    }
  }
  console.log(`features from Autocar India: ${afFilled} variants`);
  // then anything still unknown from ZigWheels variant pages (data/zigwheels-features.json)
  const ZW = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/zigwheels-features.json'), 'utf8')).models || {}; } catch (e) { return {}; } })();
  let zwFilled = 0, zwFixed = 0;
  for (const [k, list] of Object.entries(afByModel)) {
    const m = ZW[k]; if (!m) continue;
    const single = list.length === 1 && /starting|from/i.test(list[0].variant);
    for (const c of list) {
      const a = single ? m.variants.slice().sort((x, y) => (x.p || 9e18) - (y.p || 9e18))[0] : matchVariant(c, m.variants, false);
      if (!a) continue;
      let n = 0;
      // a second source saying "yes" also corrects a "no" from the maker's site (their lists often omit features rather than deny them)
      for (const kk of a.y) if (c.f[kk] == null) { c.f[kk] = true; n++; } else if (c.f[kk] === false) { c.f[kk] = true; n++; zwFixed++; }
      for (const kk of a.no) if (c.f[kk] == null) { c.f[kk] = false; n++; }
      if (c.airbags == null && a.airbags) c.airbags = a.airbags;
      if (n) { c.zw = 1; zwFilled++; }
    }
  }
  console.log(`gaps filled from ZigWheels: ${zwFilled} variants (${zwFixed} "no"s corrected to "yes")`);
  for (const c of cars) { c.fs = keys.map((k) => (c.f[k] === true ? '1' : c.f[k] === false ? '0' : '?')).join(''); delete c.f; }
  // expert opinion (Autocar India) per model, from scraper/expert.mjs
  const experts = {};
  // keep pros/cons short and consistent: at most 3 each, de-duplicated, curated short wording for long lines
  const SHORT = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/expert-short.json'), 'utf8')).map || {}; } catch (e) { return {}; } })();
  const tidy = (arr) => {
    const out = [];
    for (let t of arr || []) {
      t = String(t).trim(); t = SHORT[t] || t;
      if (t.length > 42) t = t.split(/;|\. | – | — |, which| but /)[0].replace(/\.$/, '').trim();
      if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    }
    return out.slice(0, 3);
  };
  const xf = path.join(ROOT, 'data/expert.json');
  if (fs.existsSync(xf)) {
    const X = JSON.parse(fs.readFileSync(xf, 'utf8')).models || {};
    const have = new Set(cars.map((c) => `${c.brand}|${c.model}`));
    for (const [k, v] of Object.entries(X)) {
      if (!have.has(k)) continue;
      experts[k] = { s: v.score || null, sc: v.scores || null, like: tidy(v.like), dislike: tidy(v.dislike), yt: v.video ? v.video.id : null, ytT: v.video ? v.video.title : null, url: v.url || null, rv: v.review ? v.review.title : null, basedOn: v.basedOn || null };
    }
  }
  // one standardized studio image per model, made from the maker's own press/website image by scraper/carimg.py
  const CI = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/car-images.json'), 'utf8')).models || {}; } catch (e) { return {}; } })();
  for (const c of cars) {
    const e = CI[`${c.brand}|${c.model}`];
    c.image = e && e.hero ? e.hero.img : null;
    c.image2 = null;
  }
  const rd = (f) => { const p = path.join(ROOT, 'data', f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')).models || {} : {}; };
  const have = new Set(cars.map((c) => `${c.brand}|${c.model}`));
  const pick = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => have.has(k)));
  const ncap = pick(rd('ncap.json')), usp = pick(rd('usp.json'));
  const testdrive = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/testdrive.json'), 'utf8')).brands || {}; } catch (e) { return {}; } })();
  return { generated: new Date().toISOString(), buckets: BUCKETS, features: featureMeta, brands: Object.values(brands).filter((b) => b.variants), cars, experts, ncap, usp, testdrive };
}

// ---- car page extras: photos, real-world mileage, ratings, maintenance and resale (site/data/extras.json) ----
// 5-year retained value (share of ex-showroom) by brand: a typical-market estimate, adjusted for fuel and body type
const RETAIN = { 'Maruti Suzuki': 60, Toyota: 62, Honda: 52, Hyundai: 55, Kia: 52, Mahindra: 55, Tata: 47, MG: 42, Renault: 40, Nissan: 38, Skoda: 45, Volkswagen: 45, Jeep: 45, 'Mercedes-Benz': 45, BMW: 42, Audi: 40, 'Land Rover': 48 };
function buildExtras(out) {
  const CIMG = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/car-images.json'), 'utf8')).models || {}; } catch (e) { return {}; } })();
  const raw = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/extras.json'), 'utf8')).models || {}; } catch (e) { return {}; } })();
  const byModel = {};
  for (const c of out.cars) (byModel[c.brand + '|' + c.model] = byModel[c.brand + '|' + c.model] || []).push(c);
  const minPrice = (k) => Math.min(...byModel[k].map((c) => c.price));
  // maintenance: fit log(5-yr cost) ~ a + b·log(price) on the V3Cars models, plus a brand offset where we have 2+ models
  const pts = [];
  for (const [k, x] of Object.entries(raw)) if (x.service && byModel[k] && x.service.list.length) pts.push({ b: k.split('|')[0], x: Math.log(minPrice(k)), y: Math.log(Math.min(...x.service.list.map((l) => l.y5))) });
  const n = pts.length, mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n;
  const B = n > 2 ? pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / pts.reduce((s, p) => s + (p.x - mx) ** 2, 0) : 0.5;
  const A = my - B * mx;
  const off = {};
  for (const b of new Set(pts.map((p) => p.b))) { const r = pts.filter((p) => p.b === b).map((p) => p.y - (A + B * p.x)); if (r.length >= 2) off[b] = r.sort((a, c) => a - c)[Math.floor(r.length / 2)]; }
  const models = {};
  for (const [k, list] of Object.entries(byModel)) {
    const [brand] = k.split('|'); const x = raw[k] || {};
    const fuels = [...new Set(list.map((c) => c.fuel))], body = list[0].body, pMin = minPrice(k), pMax = Math.max(...list.map((c) => c.price));
    // ratings: weighted by number of ratings (each source capped at 1,000 so one site can't drown the rest)
    const R = x.ratings || {}; let sw = 0, sv = 0, cnt = 0;
    for (const v of Object.values(R)) if (v && v.r) { const w = Math.min(v.n || 1, 1000); sw += w; sv += v.r * w; cnt += v.n || 0; }
    const rating = sw ? { avg: Math.round((sv / sw) * 10) / 10, count: cnt, sources: Object.fromEntries(Object.entries(R).filter(([, v]) => v && v.r).map(([s, v]) => [s, { r: v.r, n: v.n, url: v.url }])) } : null;
    // maintenance
    let service;
    if (x.service && x.service.list.length) {
      const y5 = x.service.list.map((l) => l.y5);
      service = { lo: Math.min(...y5), hi: Math.max(...y5), src: 'V3Cars', url: x.service.url, list: x.service.list };
    } else {
      const ev = fuels.every((f) => f === 'Electric');
      const lux = ['BMW', 'Audi', 'Mercedes-Benz', 'Land Rover', 'Volvo', 'Porsche', 'Lexus'].includes(brand);
      const est = (lux ? pMin * 0.03 : Math.exp(A + B * Math.log(pMin) + (off[brand] || 0))) * (ev ? 0.6 : 1); // luxury: ~0.6% of the price a year
      service = { lo: Math.round(est / 500) * 500, hi: Math.round(est / 500) * 500, est: true };
    }
    // resale
    let pct = RETAIN[brand] ?? 45;
    if (fuels.every((f) => f === 'Electric')) pct -= 10; else if (fuels.every((f) => f === 'CNG')) pct -= 2;
    if (body === 'SUV' || body === 'MUV / MPV') pct += 3; else if (body === 'Sedan') pct -= 3;
    pct = Math.max(30, Math.min(68, pct));
    const resale = { pct, lo: Math.round(pMin * (pct - 4) / 100), hi: Math.round(pMax * (pct + 4) / 100) };
    // real-world mileage per powertrain
    const mileage = (x.mileage || []).map((m) => ({ fuel: m.fuel, tr: m.tr, cc: m.cc, ev: m.ev, arai: m.arai, user: m.user, tested: m.tested || (m.city && m.hwy ? Math.round(((m.city + m.hwy) / 2) * 100) / 100 : m.city || m.hwy || null), city: m.city, hwy: m.hwy, evRange: m.evRange }));
    const swatch = (name) => {
      const n = name.toLowerCase(); const M = [[/white|pearl white|snow|arctic|polar|ivory|alpine/, '#f2f2f0'], [/black|onyx|obsidian|abyss|midnight|night|carbon|cosmic/, '#16171a'], [/silver|sleek|platinum|steel|chrome|metal/, '#b9bcc2'], [/grey|gray|graphite|gunmetal|titan|slate|smoke|ash|stealth/, '#6c7076'], [/red|ruby|crimson|fiery|flame|scarlet|maroon|wine|burgundy|cherry/, '#b3241c'], [/blue|navy|ocean|aqua|sapphire|azure|cobalt|teal|marina|sky/, '#2e5d93'], [/green|emerald|olive|lime|forest|jungle|tropical|teal/, '#3f6b4a'], [/orange|tangerine|sunset|copper/, '#d4692a'], [/yellow|gold|sun|amber|mustard/, '#d8b23a'], [/brown|bronze|khaki|desert|sand|beige|tan|mocha|coffee|earth|copper/, '#8a7356'], [/purple|violet|plum|magenta/, '#5d3a7a']];
      const parts = n.split(/\+| with | and |\//);
      const cols = parts.map((p) => (M.find(([re]) => re.test(p)) || [null, null])[1]).filter(Boolean);
      return cols.length ? [...new Set(cols)].slice(0, 2) : ['#9a9ca1'];
    };
    const ci = CIMG[k] || {};
    models[k] = {
      colors: (ci.colors || []).slice(0, 14).map((c) => ({ name: c.name, img: c.img, sw: swatch(c.name) })),
      interior: (ci.interior || []).slice(0, 8).map((c) => ({ cap: c.cap, img: c.img })),
      mileage, rating, service, resale,
    };
  }
  return { updated: new Date().toISOString(), models };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = normalize();
  const dest = path.join(ROOT, 'site/data');
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'cars.json'), JSON.stringify(out));
  const ex = buildExtras(out);
  fs.writeFileSync(path.join(dest, 'extras.json'), JSON.stringify(ex));
  console.log(`extras.json: ${Object.keys(ex.models).length} models`);
  console.log(`cars.json: ${out.cars.length} variants, ${out.brands.length} brands`);
  for (const b of out.brands) console.log(`  ${b.brand}: ${b.models} models / ${b.variants} variants${b.curated ? ' (curated)' : ''}`);
}
