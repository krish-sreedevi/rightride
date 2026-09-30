// Jeep India: each model page embeds a "vehicleHighlights" JSON block per trim
// (trim name, highlight bullets, ex-showroom "starting at" price).
// run() must stay self-contained: the runner serialises it into the page.
export default {
  brand: 'Jeep',
  origin: 'https://www.jeep-india.com/',
  async run() {
const MODELS = [
  { slug: 'new-compass', model: 'Compass', fuel: 'Diesel', seats: 5, body: 'SUV' },
  { slug: 'new-jeep-meridian', model: 'Meridian', fuel: 'Diesel', seats: 7, body: 'SUV' },
  { slug: 'wrangler-jl', model: 'Wrangler', fuel: 'Petrol', seats: 5, body: 'SUV', trans: 'Automatic', drive: '4x4' },
  { slug: 'new-grand-cherokee', model: 'Grand Cherokee', fuel: 'Petrol', seats: 5, body: 'SUV', trans: 'Automatic', drive: '4x4' },
];
const EDITION = /edition/i;


    const parseJeepPage = (html) => {
  const h = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const out = [];
  for (const p of h.split('"vehicleHighlights":[').slice(1)) {
    for (const blk of p.split('{"theme":').slice(1)) {
      const vn = (blk.match(/"vehicleName":"((?:[^"\\]|\\.)*)"/) || [])[1] || '';
      const name = vn.replace(/<small[\s\S]*?<\/small>/g, '').replace(/<[^>]+>/g, ' ').replace(/\\"/g, '').replace(/\s+/g, ' ').trim();
      const price = (blk.match(/"price":"([^"]+)"/) || [])[1];
      const bullets = [...blk.split('"buttons"')[0].matchAll(/"text":"((?:[^"\\]|\\.)*)"/g)]
        .map((x) => x[1].replace(/<[^>]+>/g, '').replace(/\\+u([0-9a-f]{4})/gi, (_, c) => String.fromCharCode(parseInt(c, 16))).replace(/\\+"/g, '"').trim())
        .filter(Boolean);
      if (price && name) out.push({ name, price, bullets });
    }
  }
  return out;
    };
    const jeepModels = (pages) => {
  const models = [];
  for (const M of MODELS) {
    const trims = pages[M.slug] || [];
    const variants = [];
    let ladder = []; // highlights accumulate up the regular trim ladder
    const seen = new Set();
    for (const t of trims) {
      const trim = t.name.replace(/^(jeep\s+)?(wrangler|grand cherokee)\s+/i, '').replace(/\s+/g, ' ').trim();
      const title = trim.replace(/\b([A-Z])([A-Z]+)\b/g, (_, a, b) => a + b.toLowerCase()).replace(/\bOf\b/g, 'of').replace(/\(o\)/i, '(O)').replace(/\bO$/, '(O)');
      if (seen.has(title)) continue; seen.add(title);
      const own = t.bullets.map((b) => ({ group: 'Highlights', label: b, value: 'Yes' }));
      const features = EDITION.test(trim) ? own : (ladder = [...ladder, ...own]);
      const lakh = parseFloat(String(t.price).replace(/[^\d.]/g, ''));
      const text = t.bullets.join(' ');
      const seats = /5-seater/i.test(text) ? 5 : /7-seater/i.test(text) ? 7 : M.seats;
      const auto = M.trans || (/9-speed automatic|overland/i.test(`${trim} ${text}`) ? 'Automatic' : '');
      variants.push({
        name: `${M.model} ${title}`, trim: title, fuel: M.fuel, transmission: auto,
        drive: M.drive || (/4x4/i.test(`${trim} ${text}`) ? '4x4' : ''), seats,
        price: Math.round(lakh * 100000), priceCity: 'Delhi', prices: {}, features,
      });
    }
    if (variants.length) models.push({ model: M.model, body: M.body, url: `https://www.jeep-india.com/${M.slug}.html`, variants });
  }
  return models;
    };
    const pages = {};
    for (const M of MODELS) pages[M.slug] = parseJeepPage(await RR.fetchText(`/${M.slug}.html`));
    return { models: jeepModels(pages), source: 'jeep-india.com model pages (trim highlights, starting ex-showroom)', log: RR.log };
  },
};
