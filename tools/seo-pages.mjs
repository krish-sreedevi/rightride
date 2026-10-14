// Builds plain, crawlable HTML pages for search engines (the app itself lives behind #/ routes, which Google ignores):
//   /cars/                one page listing every car on sale, by brand
//   /cars/<model-slug>/   one page per model: prices, variants, specs, safety, expert verdict, similar cars
//   /brands/<brand-slug>/ one page per brand
//   /sitemap.xml          every page above plus the home page and the legal pages
// Each page links into the interactive site (/#/car/<slug>) for on-road prices, variant matching and dealers.
// Runs in the "Deploy site" workflow after normalize.mjs:  node tools/seo-pages.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SITE = path.join(ROOT, 'site');
const ORIGIN = 'https://rightride.in';
const D = JSON.parse(fs.readFileSync(path.join(SITE, 'data/cars.json'), 'utf8'));
let X = {};
try { X = JSON.parse(fs.readFileSync(path.join(SITE, 'data/extras.json'), 'utf8')).models || {}; } catch (e) {}
const YEAR = new Date(D.generated || Date.now()).getFullYear();
const TODAY = new Date(D.generated || Date.now()).toISOString().slice(0, 10);

const slug = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const mslug = (b, m) => slug(b + ' ' + m);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lakh = (n) => (n >= 1e7 ? '₹' + (n / 1e7).toFixed(2) + ' crore' : '₹' + (n / 1e5).toFixed(2) + ' lakh');
const short = (n) => (n >= 1e7 ? '₹' + (n / 1e7).toFixed(2) + ' Cr' : '₹' + (n / 1e5).toFixed(2) + ' L');
const list = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
const bodyPhrase = (b) => ({ SUV: 'an SUV', 'MUV / MPV': 'an MUV', Sedan: 'a sedan', Hatchback: 'a hatchback', Pickup: 'a pickup truck', 'Coupe / Convertible': 'a coupe or convertible' }[b] || 'a ' + String(b).toLowerCase());
const abs = (u) => (/^https?:/.test(u) ? u : `${ORIGIN}/${String(u).replace(/^\//, '')}`);

// ---- group variants into models ----
const models = new Map();
for (const c of D.cars) {
  const k = c.brand + '|' + c.model;
  if (!models.has(k)) models.set(k, { key: k, brand: c.brand, model: c.model, body: c.body, image: c.image, url: c.url, vs: [] });
  models.get(k).vs.push(c);
}
for (const m of models.values()) {
  m.slug = mslug(m.brand, m.model);
  m.vs.sort((a, b) => a.price - b.price);
  m.min = Math.min(...m.vs.map((v) => v.price)); m.max = Math.max(...m.vs.map((v) => v.price));
  m.fuels = [...new Set(m.vs.map((v) => v.fuel))];
  m.trans = [...new Set(m.vs.map((v) => v.transmission).filter(Boolean))];
  m.seats = [...new Set(m.vs.map((v) => v.seats).filter(Boolean))].sort((a, b) => a - b);
  m.x = (D.experts || {})[m.key] || null; m.nc = (D.ncap || {})[m.key] || null; m.usp = (D.usp || {})[m.key] || []; m.e = X[m.key] || {};
}
const all = [...models.values()].sort((a, b) => a.brand.localeCompare(b.brand) || a.min - b.min);
const brands = [...new Set(all.map((m) => m.brand))].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

// ---- shared page shell ----
const page = ({ title, desc, canon, body, jsonld = [], image, track, go }) => `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><script>try{if(localStorage.getItem('rr-theme')==='dark'){document.documentElement.dataset.theme='dark';document.querySelector('meta[name=color-scheme]').content='dark'}}catch(e){}</script>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${go ? `<script>if (/[?&]go=1/.test(location.search)) location.replace(${JSON.stringify(go)});</script>` : ''}
<link rel="canonical" href="${canon}">
<meta property="og:type" content="website"><meta property="og:site_name" content="RightRide"><meta property="og:locale" content="en_IN">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${canon}">
<meta property="og:image" content="${esc(image || ORIGIN + '/brand/og-card.png?v=9')}"><meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#D02A1C">
<link rel="icon" type="image/svg+xml" href="/brand/favicon.svg?v=7s"><link rel="apple-touch-icon" href="/brand/app-icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Michroma&display=swap" onload="this.onload=null;this.rel='stylesheet'"><noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Michroma&display=swap"></noscript>
<link rel="stylesheet" href="/seo.css">
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head>
<body>
<header class="top"><a href="/" aria-label="RightRide home"><picture><img src="/brand/logo-day.webp" alt="RightRide" width="178" height="30"></picture></a>
<nav class="topnav" aria-label="Main"><a href="/cars/">All cars</a><a href="/best/">Best cars</a><a href="/compare/">Compare</a><a class="cta" href="/#/cars">Find my RightRide</a></nav></header>
<main>
${body}
</main>
<footer class="foot"><nav aria-label="Site information"><a href="/cars/">All cars</a><a href="/best/">Best cars</a><a href="/compare/">Comparisons</a><a href="/privacy.html">Privacy policy</a><a href="/terms.html">Terms and conditions</a><a href="/#feedback">Give feedback</a><a href="mailto:info@rightride.in">info@rightride.in</a></nav>
<p>© ${YEAR} RightRide. All rights reserved. Prices are ex-showroom from each maker's official website, refreshed every week; confirm with your dealer before booking. RightRide is independent and not affiliated with any carmaker.</p></footer>
<script src="/analytics.js"></script>
<script>window.rrTrack && window.rrTrack(${JSON.stringify(track)}, document.title);</script>
</body>
</html>
`;
const crumbs = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: url })) });
const crumbHtml = (items) => `<nav class="crumbs" aria-label="Breadcrumb">${items.map(([n, u], i) => (i < items.length - 1 ? `<a href="${u.replace(ORIGIN, '')}">${esc(n)}</a><span aria-hidden="true">›</span>` : `<span aria-current="page">${esc(n)}</span>`)).join('')}</nav>`;
const write = (rel, html) => { const f = path.join(SITE, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); };
const card = (m) => `<a class="car" href="/cars/${m.slug}/"><span class="ci">${m.image ? `<img src="/${esc(m.image)}" alt="${esc(m.brand + ' ' + m.model)}" loading="lazy" width="300" height="175">` : ''}</span><b>${esc(m.brand)} ${esc(m.model)}</b><small>${short(m.min)}${m.max > m.min ? ' – ' + short(m.max) : ''} · ${esc(m.body)}</small></a>`;

// ---- shared facts, closest rivals and "best of" lists (used by car, comparison and list pages) ----
const FIDX = Object.fromEntries((D.features || []).map((f, i) => [f.key, i]));
const has = (v, k) => !!(v.fs && FIDX[k] != null && v.fs[FIDX[k]] === '1');
const fx = (m) => {
  if (m._fx) return m._fx;
  const ev = m.fuels.every((f) => f === 'Electric');
  const mil = (m.e.mileage || []).map((r) => r.arai || r.tested).filter((n) => n > 5 && n < 60);
  const ranges = [...m.vs.map((v) => v.range), ...(ev ? (m.e.mileage || []).map((r) => r.arai || r.tested) : [])].filter((n) => n > 50 && n < 1500);
  return (m._fx = { ev, mil: mil.length ? [Math.min(...mil), Math.max(...mil)] : null, range: ranges.length ? [Math.min(...ranges), Math.max(...ranges)] : null,
    airbags: Math.max(0, ...m.vs.map((v) => v.airbags || 0)), auto: m.vs.find((v) => v.transmission === 'Automatic') || null,
    stars: m.nc ? m.nc.stars : null, score: m.x && m.x.s ? m.x.s : null, seatsMax: m.seats.length ? Math.max(...m.seats) : null });
};
const span = ([a, b], u) => (a === b ? `${a} ${u}` : `${a}–${b} ${u}`);
const effTxt = (m) => { const f = fx(m); return f.ev ? (f.range ? span(f.range, 'km range') : '–') : f.mil ? span(f.mil, 'km/l') : '–'; };
const priceTxt = (m) => `${short(m.min)}${m.max > m.min ? ' – ' + short(m.max) : ''}`;
// closest rivals: same body type, and the price range that overlaps most (start and top-end price both close)
const gap = (a, b) => Math.abs(Math.log(a.min / b.min)) + Math.abs(Math.log(a.max / b.max)) + (a.fuels.every((f) => f === 'Electric') !== b.fuels.every((f) => f === 'Electric') ? 0.35 : 0);
const rivals = (m, n = 4) => all.filter((o) => o !== m && o.body === m.body && gap(m, o) < 0.9).sort((a, b) => gap(m, a) - gap(m, b)).slice(0, n);
const PAIRS = new Map(), CMP = new Map();
for (const m of all) for (const o of rivals(m)) { const [a, b] = [m, o].sort((x, y) => x.slug.localeCompare(y.slug)); PAIRS.set(`${a.slug}-vs-${b.slug}`, [a, b]); }
for (const [ps, [a, b]] of PAIRS) { for (const [x, y] of [[a, b], [b, a]]) { if (!CMP.has(x.slug)) CMP.set(x.slug, []); CMP.get(x.slug).push([ps, y]); } }
// ranked by expert score plus crash-test stars (0.4 per star), then price
const merit = (m) => (fx(m).score || 0) + 0.4 * (fx(m).stars || 0);
const rank = (a, b) => merit(b) - merit(a) || a.min - b.min;
const L = 1e5;
// a variant fits "under ₹N lakh" when it costs at most N lakh; for N of 15 and above it must also cost at least half of N,
// so a ₹30 lakh list shows ₹15–30 lakh cars rather than repeating the cheapest ones
const under = (v, n) => v.price <= n * L && v.price >= (n >= 15 ? n * 0.5 * L : 0);
const LISTS = [
  ...[5, 8, 10, 15, 20, 30, 50].map((n) => ({ slug: `cars-under-${n}-lakh`, h: `Best cars under ₹${n} lakh`, short: `Under ₹${n} lakh`, v: (v) => under(v, n), q: { max: n } })),
  ...[10, 15, 20, 30].map((n) => ({ slug: `suv-under-${n}-lakh`, h: `Best SUVs under ₹${n} lakh`, short: `SUVs under ₹${n} lakh`, v: (v, m) => m.body === 'SUV' && under(v, n), q: { body: 'SUV', max: n } })),
  { slug: 'hatchbacks', h: 'Best hatchbacks in India', short: 'Hatchbacks', v: (v, m) => m.body === 'Hatchback', q: { body: 'Hatchback' } },
  { slug: 'sedans', h: 'Best sedans in India', short: 'Sedans', v: (v, m) => m.body === 'Sedan', q: { body: 'Sedan' } },
  { slug: 'muv-mpv', h: 'Best MUVs and MPVs in India', short: 'MUVs / MPVs', v: (v, m) => m.body === 'MUV / MPV', q: { body: 'MUV / MPV' } },
  { slug: '7-seater-cars', h: 'Best 7-seater cars in India', short: '7-seaters', v: (v) => v.seats >= 7, q: { seats: '7' } },
  { slug: '7-seater-cars-under-20-lakh', h: 'Best 7-seater cars under ₹20 lakh', short: '7-seaters under ₹20 lakh', v: (v) => v.seats >= 7 && under(v, 20), q: { seats: '7', max: 20 } },
  { slug: 'automatic-cars-under-10-lakh', h: 'Best automatic cars under ₹10 lakh', short: 'Automatics under ₹10 lakh', v: (v) => v.transmission === 'Automatic' && under(v, 10), q: { trans: 'Automatic', max: 10 } },
  { slug: 'automatic-cars-under-15-lakh', h: 'Best automatic cars under ₹15 lakh', short: 'Automatics under ₹15 lakh', v: (v) => v.transmission === 'Automatic' && under(v, 15), q: { trans: 'Automatic', max: 15 } },
  { slug: 'electric-cars', h: 'Best electric cars in India', short: 'Electric cars', v: (v) => v.fuel === 'Electric', q: { fuel: 'Electric' } },
  { slug: 'electric-cars-under-20-lakh', h: 'Best electric cars under ₹20 lakh', short: 'EVs under ₹20 lakh', v: (v) => v.fuel === 'Electric' && under(v, 20), q: { fuel: 'Electric', max: 20 } },
  { slug: 'cng-cars', h: 'Best CNG cars in India', short: 'CNG cars', v: (v) => v.fuel === 'CNG', q: { fuel: 'CNG' } },
  { slug: 'hybrid-cars', h: 'Best hybrid cars in India', short: 'Hybrids', v: (v) => v.fuel === 'Hybrid' || v.fuel === 'PHEV', q: { fuel: 'Hybrid' } },
  { slug: 'diesel-cars', h: 'Best diesel cars in India', short: 'Diesel cars', v: (v) => v.fuel === 'Diesel', q: { fuel: 'Diesel' } },
  { slug: 'diesel-suv-under-20-lakh', h: 'Best diesel SUVs under ₹20 lakh', short: 'Diesel SUVs under ₹20 lakh', v: (v, m) => m.body === 'SUV' && v.fuel === 'Diesel' && under(v, 20), q: { body: 'SUV', fuel: 'Diesel', max: 20 } },
  { slug: 'safest-cars', h: 'Safest cars in India (5-star crash rating)', short: '5-star safety', v: (v, m) => fx(m).stars === 5, q: {} },
  { slug: 'safest-cars-under-10-lakh', h: 'Safest cars under ₹10 lakh', short: 'Safest under ₹10 lakh', v: (v, m) => (fx(m).stars || 0) >= 4 && under(v, 10), q: { max: 10 } },
  { slug: 'cars-with-sunroof-under-15-lakh', h: 'Best cars with a sunroof under ₹15 lakh', short: 'Sunroof under ₹15 lakh', v: (v) => (has(v, 'sunroof') || has(v, 'panoramic')) && under(v, 15), q: { feats: 'sunroof', max: 15 } },
  { slug: 'cars-with-adas', h: 'Cheapest cars with ADAS in India', short: 'Cars with ADAS', v: (v) => has(v, 'adas'), q: { feats: 'adas' }, byPrice: true },
  { slug: 'cars-with-6-airbags-under-10-lakh', h: 'Cars with 6 airbags under ₹10 lakh', short: '6 airbags under ₹10 lakh', v: (v) => (v.airbags || 0) >= 6 && under(v, 10), q: { feats: 'airbags6', max: 10 } },
];
const qsOf = (q) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(q)) p.set(k, String(v)); const s = p.toString(); return `/${s ? '?' + s : ''}#/cars`; };
for (const l of LISTS) {
  l.items = all.map((m) => { const ok = m.vs.filter((v) => l.v(v, m)); return ok.length ? { m, from: Math.min(...ok.map((v) => v.price)), n: ok.length } : null; }).filter(Boolean)
    .sort((a, b) => (l.byPrice ? a.from - b.from : rank(a.m, b.m) || a.from - b.from)).slice(0, 15);
}
const LIVE = LISTS.filter((l) => l.items.length >= 3);
const IN_LISTS = new Map();
for (const l of LIVE) l.items.forEach((it, i) => { if (i < 10) { if (!IN_LISTS.has(it.m.slug)) IN_LISTS.set(it.m.slug, []); IN_LISTS.get(it.m.slug).push(l); } });

// ---- one page per model ----
const urls = [[`${ORIGIN}/`, '1.0'], [`${ORIGIN}/cars/`, '0.9']];
for (const m of all) {
  const name = `${m.brand} ${m.model}`, canon = `${ORIGIN}/cars/${m.slug}/`, app = `/#/car/${m.slug}`;
  const mil = (m.e.mileage || []).map((r) => r.arai || r.tested).filter((n) => n > 0);
  const ranges = m.vs.map((v) => v.range).filter(Boolean);
  const effic = m.fuels.every((f) => f === 'Electric') && ranges.length ? `${Math.min(...ranges)}–${Math.max(...ranges)} km range` : mil.length ? `${Math.min(...mil)}–${Math.max(...mil)} km/l` : '';
  const airbags = Math.max(0, ...m.vs.map((v) => v.airbags || 0));
  const similar = all.filter((o) => o !== m && o.body === m.body && o.min >= m.min * 0.7 && o.min <= m.min * 1.35).sort((a, b) => Math.abs(a.min - m.min) - Math.abs(b.min - m.min)).slice(0, 6);
  const desc = `${name} price in India starts at ${lakh(m.min)}${m.max > m.min ? ` and goes up to ${lakh(m.max)}` : ''} (ex-showroom). Compare all ${m.vs.length} variant${m.vs.length > 1 ? 's' : ''}, ${m.fuels.join('/').toLowerCase()} options, features, safety rating and on-road price in your state.`;
  const facts = [
    ['Ex-showroom price', `${short(m.min)}${m.max > m.min ? ' – ' + short(m.max) : ''}`],
    ['Body type', m.body], ['Fuel', m.fuels.join(', ')], ['Gearbox', m.trans.join(', ') || '–'],
    ['Seats', m.seats.join(' / ') || '–'], ['Variants', String(m.vs.length)],
    effic ? [m.fuels.every((f) => f === 'Electric') ? 'Range' : 'Mileage (claimed)', effic] : null,
    airbags ? ['Airbags', `Up to ${airbags}`] : null,
    m.nc ? ['Safety rating', `${m.nc.stars}-star (${m.nc.by})`] : null,
    m.x && m.x.s ? ['Expert score', `${m.x.s}/10`] : null,
  ].filter(Boolean);
  let body = `${crumbHtml([['Home', ORIGIN + '/'], ['Cars', ORIGIN + '/cars/'], [m.brand, `${ORIGIN}/brands/${slug(m.brand)}/`], [m.model, canon]])}
<section class="hero">
  <div class="hero-img">${m.image ? `<img src="/${esc(m.image)}" alt="${esc(name)}" width="1200" height="700" fetchpriority="high">` : ''}</div>
  <div class="hero-txt">
    <p class="eyebrow">${esc(m.brand)} · ${esc(m.body)}</p>
    <h1>${esc(name)}</h1>
    <p class="price">${short(m.min)}${m.max > m.min ? ` <span>– ${short(m.max)}</span>` : ''}</p>
    <p class="muted">Ex-showroom price in India. On-road prices for your state include road tax, registration, insurance, FASTag and TCS.</p>
    <p class="actions"><a class="btn primary" href="${app}">See on-road price in your state</a><a class="btn" href="${app}">Compare variants &amp; find dealers</a></p>
    <p class="actions"><a class="btn" href="${m.x && m.x.yt ? `https://www.youtube.com/watch?v=${esc(m.x.yt)}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(`${m.brand} ${m.model} review`)}`}" rel="noopener" target="_blank">▶ Watch expert video</a>${m.url ? `<a class="btn" href="${esc(m.url)}" rel="noopener" target="_blank">Official site ↗</a>` : ''}</p>
  </div>
</section>
<p class="lede">The ${esc(name)} is ${esc(bodyPhrase(m.body))} available with ${esc(list(m.fuels.map((f) => f.toLowerCase())))} power and ${esc(list(m.trans.map((t) => t.toLowerCase())))} gearbox${m.trans.length > 1 ? ' options' : ''}${m.seats.length ? `, seating ${m.seats.join(' or ')}` : ''}. It is sold in ${m.vs.length} variant${m.vs.length > 1 ? 's' : ''}, priced from ${lakh(m.min)}${m.max > m.min ? ` to ${lakh(m.max)}` : ''} ex-showroom${m.nc ? `, and has a ${m.nc.stars}-star ${esc(m.nc.by)} safety rating` : ''}.</p>
<section><h2>${esc(name)} key facts</h2><dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section>
${m.usp.length ? `<section><h2>Why people pick the ${esc(m.model)}</h2><ul class="ticks">${m.usp.map((u) => `<li>${esc(u)}</li>`).join('')}</ul></section>` : ''}
${m.x && (m.x.like || m.x.dislike) ? `<section><h2>Expert verdict</h2><div class="two"><div><h3>Likes</h3><ul class="ticks">${(m.x.like || []).map((u) => `<li>${esc(u)}</li>`).join('')}</ul></div><div><h3>Dislikes</h3><ul class="crosses">${(m.x.dislike || []).map((u) => `<li>${esc(u)}</li>`).join('')}</ul></div></div></section>` : ''}
<section><h2>${esc(name)} variants and prices</h2>
<div class="scroll"><table><thead><tr><th>Variant</th><th>Fuel</th><th>Gearbox</th><th class="n">Ex-showroom</th></tr></thead><tbody>
${m.vs.map((v) => `<tr><td>${esc(v.variant)}</td><td>${esc(v.fuel)}</td><td>${esc(v.transmission || '–')}${v.transType && v.transType !== v.transmission ? ` <small>(${esc(v.transType)})</small>` : ''}</td><td class="n">${short(v.price)}</td></tr>`).join('\n')}
</tbody></table></div>
<p class="muted small">Prices from ${esc(m.brand)}'s official website${m.vs[0].priceCity ? ` (${esc(m.vs[0].priceCity)})` : ''}, updated ${esc(TODAY)}. <a href="${app}">Find the variant with the features you want →</a></p></section>
${(m.e.colors || []).length ? `<section><h2>${esc(name)} colours</h2><p>${esc(list(m.e.colors.map((c) => c.name)))}.</p></section>` : ''}
${similar.length ? `<section><h2>Similar cars to the ${esc(m.model)}</h2><div class="cars">${similar.map(card).join('')}</div><p><a href="/#/compare/${[m, ...similar.slice(0, 2)].map((o) => o.slug).join(',')}">Compare the ${esc(m.model)} with the ${esc(similar.slice(0, 2).map((o) => o.model).join(' and '))} →</a></p></section>` : ''}
${(CMP.get(m.slug) || []).length ? `<section><h2>${esc(m.model)} vs rivals</h2><ul class="links">${CMP.get(m.slug).map(([ps, o]) => `<li><a href="/compare/${ps}/">${esc(m.model)} vs ${esc(o.brand)} ${esc(o.model)}</a></li>`).join('')}</ul></section>` : ''}
${(IN_LISTS.get(m.slug) || []).length ? `<section><h2>Featured in</h2><ul class="links">${IN_LISTS.get(m.slug).map((l) => `<li><a href="/best/${l.slug}/">${esc(l.h)}</a></li>`).join('')}</ul></section>` : ''}
<section class="more"><h2>More from ${esc(m.brand)}</h2><p><a href="/brands/${slug(m.brand)}/">All ${esc(m.brand)} cars and prices →</a></p></section>`;
  // short, factual answers to the questions people (and AI assistants) ask about a car
  const cheapest = m.vs[0], top = m.vs[m.vs.length - 1];
  const firstAuto = m.vs.find((v) => v.transmission === 'Automatic');
  const qa = [
    [`What is the price of the ${name}?`, `The ${name} costs ${lakh(m.min)}${m.max > m.min ? ` to ${lakh(m.max)}` : ''} ex-showroom in India (${TODAY}). The on-road price adds road tax, registration, insurance, FASTag and TCS, and depends on your state.`],
    [`Which is the cheapest ${name} variant?`, `The ${cheapest.variant} (${cheapest.fuel}, ${cheapest.transmission || 'manual'}) at ${lakh(cheapest.price)} ex-showroom.${m.vs.length > 1 ? ` The top variant is the ${top.variant} at ${lakh(top.price)}.` : ''}`],
    ...(firstAuto && m.trans.length > 1 ? [[`What is the cheapest automatic ${name}?`, `The ${firstAuto.variant} (${firstAuto.fuel}) at ${lakh(firstAuto.price)} ex-showroom.`]] : []),
    ...(effic ? [[`What is the ${m.fuels.every((f) => f === 'Electric') ? 'range' : 'mileage'} of the ${name}?`, `${effic}${m.fuels.every((f) => f === 'Electric') ? ' (certified)' : ' (claimed by the maker)'}.`]] : []),
    ...(m.nc ? [[`Is the ${name} safe?`, `It has a ${m.nc.stars}-star ${m.nc.by} crash-test rating${airbags ? ` and up to ${airbags} airbags` : ''}.`]] : airbags ? [[`How many airbags does the ${name} have?`, `Up to ${airbags}, depending on the variant.`]] : []),
    [`What fuel and gearbox options does the ${name} have?`, `${list(m.fuels)} with ${list(m.trans.map((t) => t.toLowerCase()))} transmission${m.trans.length > 1 ? 's' : ''}; ${m.vs.length} variant${m.vs.length > 1 ? 's' : ''} in all.`],
  ];
  body += `\n<section><h2>${esc(name)}: quick answers</h2><dl class="qa">${qa.map(([q, a]) => `<div><dt>${esc(q)}</dt><dd>${esc(a)}</dd></div>`).join('')}</dl></section>`;
  const jsonld = [
    crumbs([['Home', ORIGIN + '/'], ['Cars', ORIGIN + '/cars/'], [m.brand, `${ORIGIN}/brands/${slug(m.brand)}/`], [m.model, canon]]),
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qa.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    { '@context': 'https://schema.org', '@type': 'Car', name, brand: { '@type': 'Brand', name: m.brand }, model: m.model, bodyType: m.body, fuelType: m.fuels.join(', '), vehicleTransmission: m.trans.join(', '), ...(m.seats.length ? { seatingCapacity: Math.max(...m.seats) } : {}), ...(m.image ? { image: abs(m.image) } : {}), url: canon, description: desc, offers: { '@type': 'AggregateOffer', priceCurrency: 'INR', lowPrice: m.min, highPrice: m.max, offerCount: m.vs.length, availability: 'https://schema.org/InStock' } },
  ];
  write(`cars/${m.slug}/index.html`, page({ title: `${name} Price ${YEAR}, Variants, Mileage & Features | RightRide`, desc, canon, body, jsonld, image: m.image ? abs(m.image) : null, track: `/seo/car/${m.slug}`, go: app }));
  urls.push([canon, '0.8']);
}

// ---- one page per brand ----
for (const b of brands) {
  const ms = all.filter((m) => m.brand === b), canon = `${ORIGIN}/brands/${slug(b)}/`;
  const lo = Math.min(...ms.map((m) => m.min)), hi = Math.max(...ms.map((m) => m.max));
  const desc = `${b} cars in India: ${ms.length} model${ms.length > 1 ? 's' : ''} priced from ${lakh(lo)} to ${lakh(hi)} (ex-showroom). Compare ${list(ms.slice(0, 4).map((m) => m.model))}${ms.length > 4 ? ' and more' : ''}.`;
  const body = `${crumbHtml([['Home', ORIGIN + '/'], ['Cars', ORIGIN + '/cars/'], [b, canon]])}
<h1>${esc(b)} cars in India</h1>
<p class="lede">${esc(b)} sells ${ms.length} model${ms.length > 1 ? 's' : ''} in India, from ${lakh(lo)} to ${lakh(hi)} ex-showroom. Pick one for its variants, prices, safety rating and expert verdict, or <a href="/?brand=${encodeURIComponent(b)}#/cars">filter ${esc(b)} cars by the features you want</a>.</p>
<div class="cars">${ms.map(card).join('')}</div>
<div class="scroll"><table><thead><tr><th>Model</th><th>Body</th><th>Fuel</th><th class="n">Ex-showroom price</th></tr></thead><tbody>${ms.map((m) => `<tr><td><a href="/cars/${m.slug}/">${esc(m.model)}</a></td><td>${esc(m.body)}</td><td>${esc(m.fuels.join(', '))}</td><td class="n">${short(m.min)}${m.max > m.min ? ' – ' + short(m.max) : ''}</td></tr>`).join('')}</tbody></table></div>`;
  write(`brands/${slug(b)}/index.html`, page({ title: `${b} Cars in India ${YEAR}: Prices, Models & Variants | RightRide`, desc, canon, body, jsonld: [crumbs([['Home', ORIGIN + '/'], ['Cars', ORIGIN + '/cars/'], [b, canon]])], track: `/seo/brand/${slug(b)}` }));
  urls.push([canon, '0.7']);
}

// ---- all cars ----
{
  const canon = `${ORIGIN}/cars/`;
  const body = `${crumbHtml([['Home', ORIGIN + '/'], ['Cars', canon]])}
<h1>Cars in India ${YEAR}</h1>
<p class="lede">Every car on sale in India: ${all.length} models and ${D.cars.length} variants from ${brands.length} brands, with ex-showroom prices from each maker's official website. <a href="/#/cars">Filter them by budget and features, and see on-road prices for your state →</a></p>
<p class="actions"><a class="btn" href="/best/">Best cars by budget &amp; type</a><a class="btn" href="/compare/">Head-to-head comparisons</a></p>
<nav class="brandnav" aria-label="Brands">${brands.map((b) => `<a href="#${slug(b)}">${esc(b)}</a>`).join('')}</nav>
${brands.map((b) => `<section id="${slug(b)}"><h2><a href="/brands/${slug(b)}/">${esc(b)}</a></h2><div class="cars">${all.filter((m) => m.brand === b).map(card).join('')}</div></section>`).join('\n')}`;
  write('cars/index.html', page({ title: `Cars in India ${YEAR}: Prices, Variants & Features of Every Model | RightRide`, desc: `Compare all ${all.length} car models on sale in India from ${brands.length} brands: ex-showroom prices, variants, mileage, safety ratings and features.`, canon, body, jsonld: [crumbs([['Home', ORIGIN + '/'], ['Cars', canon]]), { '@context': 'https://schema.org', '@type': 'Dataset', name: 'Cars on sale in India: models, variants and ex-showroom prices', description: `Every car on sale in India (${all.length} models, ${D.cars.length} variants, ${brands.length} brands) with ex-showroom prices from each maker's official website, fuel, gearbox, seats, safety rating and expert score. Updated weekly.`, url: canon, license: 'https://rightride.in/terms.html', isAccessibleForFree: true, creator: { '@type': 'Organization', name: 'RightRide', url: ORIGIN }, dateModified: TODAY, spatialCoverage: 'India', distribution: [{ '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${ORIGIN}/api/models.json` }] }], track: '/seo/cars' }));
}

// ---- comparison pages: /compare/<a>-vs-<b>/ for every model and its closest rivals ----
for (const [ps, [a, b]] of PAIRS) {
  const A = fx(a), B = fx(b), na = `${a.brand} ${a.model}`, nb = `${b.brand} ${b.model}`, canon = `${ORIGIN}/compare/${ps}/`, app = `/#/compare/${a.slug},${b.slug}`;
  const rows = [
    ['Ex-showroom price', priceTxt(a), priceTxt(b)], ['Body type', a.body, b.body], ['Fuel', a.fuels.join(', '), b.fuels.join(', ')],
    ['Gearbox', a.trans.join(', ') || '–', b.trans.join(', ') || '–'], ['Seats', a.seats.join(' / ') || '–', b.seats.join(' / ') || '–'],
    [A.ev || B.ev ? 'Mileage / range' : 'Mileage (claimed)', effTxt(a), effTxt(b)], ['Airbags (max)', A.airbags || '–', B.airbags || '–'],
    ['Crash-test rating', a.nc ? `${a.nc.stars}-star (${a.nc.by})` : 'Not tested', b.nc ? `${b.nc.stars}-star (${b.nc.by})` : 'Not tested'],
    ['Expert score', A.score ? `${A.score}/10` : '–', B.score ? `${B.score}/10` : '–'], ['Variants', a.vs.length, b.vs.length],
    ['Cheapest automatic', A.auto ? short(A.auto.price) : '–', B.auto ? short(B.auto.price) : '–'],
  ];
  const pts = [];
  const cheaper = a.min < b.min ? [a, b] : [b, a];
  pts.push(`The ${cheaper[0].model} is cheaper to get into: it starts at ${lakh(cheaper[0].min)} against ${lakh(cheaper[1].min)} for the ${cheaper[1].model}.`);
  if (A.stars && B.stars && A.stars !== B.stars) { const s = A.stars > B.stars ? [a, A, b, B] : [b, B, a, A]; pts.push(`The ${s[0].model} has the better crash-test result (${s[1].stars} stars vs ${s[3].stars}).`); }
  else if (A.stars && !B.stars) pts.push(`Only the ${a.model} has been crash-tested (${A.stars} stars).`); else if (B.stars && !A.stars) pts.push(`Only the ${b.model} has been crash-tested (${B.stars} stars).`);
  if (!A.ev && !B.ev && A.mil && B.mil && A.mil[1] !== B.mil[1]) { const s = A.mil[1] > B.mil[1] ? [a, A] : [b, B]; pts.push(`The ${s[0].model} claims better mileage (up to ${s[1].mil[1]} km/l).`); }
  if (A.score && B.score && A.score !== B.score) { const s = A.score > B.score ? [a, A, B] : [b, B, A]; pts.push(`Expert reviewers rate the ${s[0].model} higher (${s[1].score}/10 vs ${s[2].score}/10).`); }
  if (A.seatsMax && B.seatsMax && A.seatsMax !== B.seatsMax) { const s = A.seatsMax > B.seatsMax ? [a, A] : [b, B]; pts.push(`The ${s[0].model} seats more people (up to ${s[1].seatsMax}).`); }
  if (A.auto && !B.auto) pts.push(`Only the ${a.model} offers an automatic gearbox.`); else if (B.auto && !A.auto) pts.push(`Only the ${b.model} offers an automatic gearbox.`);
  const qa = [
    [`Which is cheaper, the ${na} or the ${nb}?`, `The ${cheaper[0].brand} ${cheaper[0].model} starts at ${lakh(cheaper[0].min)} ex-showroom; the ${cheaper[1].brand} ${cheaper[1].model} starts at ${lakh(cheaper[1].min)}. Prices updated ${TODAY}.`],
    [`Which is safer, the ${a.model} or the ${b.model}?`, A.stars || B.stars ? `${a.model}: ${a.nc ? `${a.nc.stars}-star ${a.nc.by}` : 'not crash-tested yet'}; ${b.model}: ${b.nc ? `${b.nc.stars}-star ${b.nc.by}` : 'not crash-tested yet'}. Up to ${A.airbags || '?'} and ${B.airbags || '?'} airbags respectively.` : `Neither has a published crash-test rating yet. The ${a.model} has up to ${A.airbags || '?'} airbags and the ${b.model} up to ${B.airbags || '?'}.`],
    [`Which is better, the ${a.model} or the ${b.model}?`, `${pts.join(' ')} Which suits you depends on your budget and the features you need: RightRide's matcher ranks both against your priorities and shows on-road prices for your state.`],
  ];
  const body = `${crumbHtml([['Home', ORIGIN + '/'], ['Compare', ORIGIN + '/compare/'], [`${a.model} vs ${b.model}`, canon]])}
<h1>${esc(na)} vs ${esc(nb)}</h1>
<p class="lede">${esc(pts.join(' '))}</p>
<div class="vs">${[a, b].map((m) => `<a class="car" href="/cars/${m.slug}/"><span class="ci">${m.image ? `<img src="/${esc(m.image)}" alt="${esc(m.brand + ' ' + m.model)}" width="300" height="175">` : ''}</span><b>${esc(m.brand)} ${esc(m.model)}</b><small>${priceTxt(m)}</small></a>`).join('')}</div>
<p class="actions"><a class="btn primary" href="${app}">Compare features &amp; on-road prices</a><a class="btn" href="/cars/${a.slug}/">${esc(a.model)} details</a><a class="btn" href="/cars/${b.slug}/">${esc(b.model)} details</a></p>
<section><h2>${esc(a.model)} vs ${esc(b.model)}: specs and prices</h2>
<div class="scroll"><table><thead><tr><th></th><th>${esc(na)}</th><th>${esc(nb)}</th></tr></thead><tbody>${rows.map(([k, x, y]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(x)}</td><td>${esc(y)}</td></tr>`).join('')}</tbody></table></div>
<p class="muted small">Ex-showroom prices from each maker's official website, updated ${esc(TODAY)}. On-road prices depend on your state.</p></section>
<section><h2>Quick answers</h2><dl class="qa">${qa.map(([q, x]) => `<div><dt>${esc(q)}</dt><dd>${esc(x)}</dd></div>`).join('')}</dl></section>
${[a, b].map((m) => (CMP.get(m.slug) || []).filter(([p]) => p !== ps)).flat().length ? `<section><h2>More comparisons</h2><ul class="links">${[a, b].map((m) => (CMP.get(m.slug) || []).filter(([p]) => p !== ps).map(([p, o]) => `<li><a href="/compare/${p}/">${esc(m.model)} vs ${esc(o.model)}</a></li>`).join('')).join('')}</ul></section>` : ''}`;
  write(`compare/${ps}/index.html`, page({ title: `${a.model} vs ${b.model} ${YEAR}: Price, Mileage, Safety & Features | RightRide`, desc: `${na} vs ${nb}: ${priceTxt(a)} vs ${priceTxt(b)} ex-showroom. Compare mileage, safety ratings, airbags, gearboxes, seats and expert scores side by side.`, canon, body,
    jsonld: [crumbs([['Home', ORIGIN + '/'], ['Compare', ORIGIN + '/compare/'], [`${a.model} vs ${b.model}`, canon]]), { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qa.map(([q, x]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: x } })) }],
    image: a.image ? abs(a.image) : null, track: `/seo/compare/${ps}`, go: app }));
  urls.push([canon, '0.6']);
}
{
  const canon = `${ORIGIN}/compare/`;
  const groups = brands.map((b) => [b, all.filter((m) => m.brand === b && (CMP.get(m.slug) || []).length)]).filter(([, ms]) => ms.length);
  const body = `${crumbHtml([['Home', ORIGIN + '/'], ['Compare', canon]])}
<h1>Car comparisons</h1>
<p class="lede">${PAIRS.size} head-to-head comparisons of cars on sale in India, each against its closest rivals on price and body type. Or <a href="/#/cars">pick any three cars and compare them yourself</a>.</p>
${groups.map(([b, ms]) => `<section><h2>${esc(b)}</h2><ul class="links">${ms.map((m) => CMP.get(m.slug).map(([p, o]) => `<li><a href="/compare/${p}/">${esc(m.model)} vs ${esc(o.brand)} ${esc(o.model)}</a></li>`).join('')).join('')}</ul></section>`).join('\n')}`;
  write('compare/index.html', page({ title: `Car Comparisons ${YEAR}: Head-to-Head Prices, Mileage & Safety | RightRide`, desc: `${PAIRS.size} side-by-side comparisons of cars on sale in India: prices, mileage, safety ratings, airbags and expert scores.`, canon, body, jsonld: [crumbs([['Home', ORIGIN + '/'], ['Compare', canon]])], track: '/seo/compare' }));
  urls.push([canon, '0.7']);
}

// ---- "best of" lists: /best/<slug>/ (ranked by expert score and crash-test rating, then price) ----
for (const l of LIVE) {
  const canon = `${ORIGIN}/best/${l.slug}/`, filt = qsOf(l.q);
  const top = l.items.slice(0, 3).map((it) => it.m);
  const why = (it) => [fx(it.m).score ? `${fx(it.m).score}/10 expert score` : '', fx(it.m).stars ? `${fx(it.m).stars}-star ${it.m.nc.by}` : '', effTxt(it.m) !== '–' ? effTxt(it.m) : ''].filter(Boolean).join(' · ');
  const intro = l.byPrice ? `The cheapest cars you can buy with ${esc(l.short.replace(/^Cars with /, ''))} in India right now, from ${lakh(l.items[0].from)} ex-showroom.` : `${l.items.length} cars that fit, ranked by expert review score and crash-test rating, then price. Prices are ex-showroom for the cheapest variant that qualifies; on-road prices depend on your state.`;
  const qa = [[`What are the ${l.h.replace(/ \(.*\)$/, '').replace(/^(Best|Cheapest|Safest|Cars)\b/, (w) => w.toLowerCase())}?`, l.byPrice ? `The ${top[0].brand} ${top[0].model} is the cheapest, from ${lakh(l.items[0].from)} ex-showroom, followed by the ${top[1].model} and the ${top[2].model}.` : `By expert scores and crash-test ratings: the ${top.map((m) => `${m.brand} ${m.model}`).join(', the ')}. ${why(l.items[0]) ? `The ${top[0].model} leads with ${why(l.items[0])}.` : ''} The right pick depends on your budget, fuel and must-have features.`]];
  const body = `${crumbHtml([['Home', ORIGIN + '/'], ['Best cars', ORIGIN + '/best/'], [l.short, canon]])}
<h1>${esc(l.h)} (${YEAR})</h1>
<p class="lede">${intro} <a href="${esc(filt)}">Filter these by your own must-haves →</a></p>
<ol class="rank">${l.items.map((it, i) => `<li><a class="car row" href="/cars/${it.m.slug}/"><span class="n">${i + 1}</span><span class="ci">${it.m.image ? `<img src="/${esc(it.m.image)}" alt="${esc(it.m.brand + ' ' + it.m.model)}" loading="${i < 2 ? 'eager' : 'lazy'}" width="300" height="175">` : ''}</span><span class="t"><b>${esc(it.m.brand)} ${esc(it.m.model)}</b><small>From ${short(it.from)} · ${esc(it.m.body)} · ${esc(it.m.fuels.join(', '))}</small>${why(it) ? `<small>${esc(why(it))}</small>` : ''}</span></a></li>`).join('')}</ol>
<section><h2>Quick answer</h2><dl class="qa">${qa.map(([q, x]) => `<div><dt>${esc(q)}</dt><dd>${esc(x)}</dd></div>`).join('')}</dl></section>
<section><h2>More lists</h2><ul class="links">${LIVE.filter((o) => o !== l).map((o) => `<li><a href="/best/${o.slug}/">${esc(o.h)}</a></li>`).join('')}</ul></section>`;
  write(`best/${l.slug}/index.html`, page({ title: `${l.h} ${YEAR}: Prices, Safety & Expert Scores | RightRide`, desc: `${l.h}: ${top.map((m) => m.model).join(', ')} and ${Math.max(0, l.items.length - 3)} more, ranked by expert score and safety with ex-showroom prices updated ${TODAY}.`, canon, body,
    jsonld: [crumbs([['Home', ORIGIN + '/'], ['Best cars', ORIGIN + '/best/'], [l.short, canon]]),
      { '@context': 'https://schema.org', '@type': 'ItemList', name: l.h, numberOfItems: l.items.length, itemListOrder: 'https://schema.org/ItemListOrderDescending', itemListElement: l.items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, url: `${ORIGIN}/cars/${it.m.slug}/`, name: `${it.m.brand} ${it.m.model}` })) },
      { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qa.map(([q, x]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: x } })) }],
    image: top[0].image ? abs(top[0].image) : null, track: `/seo/best/${l.slug}` }));
  urls.push([canon, '0.8']);
}
{
  const canon = `${ORIGIN}/best/`;
  const body = `${crumbHtml([['Home', ORIGIN + '/'], ['Best cars', canon]])}
<h1>Best cars in India ${YEAR}</h1>
<p class="lede">Shortlists for the most common car-buying questions, ranked by expert review scores and crash-test ratings, with ex-showroom prices from each maker's website (updated ${TODAY}). For a list built around you, <a href="/#/cars">tell RightRide what matters</a>.</p>
<div class="cars">${LIVE.map((l) => `<a class="car" href="/best/${l.slug}/"><span class="ci">${l.items[0].m.image ? `<img src="/${esc(l.items[0].m.image)}" alt="" loading="lazy" width="300" height="175">` : ''}</span><b>${esc(l.h)}</b><small>${l.items.slice(0, 3).map((it) => esc(it.m.model)).join(', ')}…</small></a>`).join('')}</div>`;
  write('best/index.html', page({ title: `Best Cars in India ${YEAR}: By Budget, Body Type, Fuel & Safety | RightRide`, desc: `Shortlists of the best cars in India by budget (under ₹5, 10, 15, 20 lakh), SUVs, 7-seaters, automatics, EVs, CNG and the safest cars, ranked by expert scores and crash tests.`, canon, body, jsonld: [crumbs([['Home', ORIGIN + '/'], ['Best cars', canon]])], track: '/seo/best' }));
  urls.push([canon, '0.9']);
}

// ---- open data for apps and AI assistants: every model and variant with prices, as plain JSON ----
const api = { source: ORIGIN, updated: TODAY, currency: 'INR', priceType: 'ex-showroom', note: 'Prices from each maker\'s official India website, refreshed weekly. On-road prices vary by state: see ' + ORIGIN + '/#/cars',
  models: all.map((m) => ({ brand: m.brand, model: m.model, body: m.body, url: `${ORIGIN}/cars/${m.slug}/`, fuels: m.fuels, transmissions: m.trans, seats: m.seats, priceMin: m.min, priceMax: m.max,
    safety: m.nc ? { stars: m.nc.stars, by: m.nc.by } : null, expertScore: m.x && m.x.s ? m.x.s : null,
    variants: m.vs.map((v) => ({ name: v.variant, fuel: v.fuel, transmission: v.transmission, price: v.price, ...(v.airbags ? { airbags: v.airbags } : {}), ...(v.range ? { rangeKm: v.range } : {}) })) })) };
write('api/models.json', JSON.stringify(api));
write('llms.txt', `# RightRide

> RightRide (rightride.in) is an independent guide to buying a car in India. It lists every car on sale (${all.length} models, ${D.cars.length} variants, ${brands.length} brands) with ex-showroom prices taken weekly from each maker's official website, on-road price estimates for every Indian state, variant-by-variant features, mileage, crash-test ratings, expert verdicts and nearby dealers.

Prices are ex-showroom in Indian rupees unless stated. On-road prices (road tax, registration, insurance, FASTag, TCS) depend on the state and are shown in the interactive site. Last updated ${TODAY}.

## Car pages
- [All cars in India](${ORIGIN}/cars/): every model, grouped by brand
${brands.map((b) => `- [${b} cars](${ORIGIN}/brands/${slug(b)}/): ${((n) => n + (n === 1 ? ' model' : ' models'))(all.filter((m) => m.brand === b).length)}`).join('\n')}

## Data
- [All models and variants as JSON](${ORIGIN}/api/models.json): brand, model, body, fuels, gearboxes, seats, price range, safety rating, expert score and every variant with its ex-showroom price
- [Sitemap](${ORIGIN}/sitemap.xml)

## Best-car shortlists (ranked by expert score and crash-test rating, then price)
${LIVE.map((l) => `- [${l.h}](${ORIGIN}/best/${l.slug}/): ${l.items.slice(0, 3).map((it) => it.m.brand + ' ' + it.m.model).join(', ')}`).join('\n')}

## Head-to-head comparisons
- [All ${PAIRS.size} comparisons](${ORIGIN}/compare/): each model against its closest rivals, e.g. ${[...PAIRS.keys()].slice(0, 3).map((p) => `${ORIGIN}/compare/${p}/`).join(', ')}

## Full data in one file
- [llms-full.txt](${ORIGIN}/llms-full.txt): one line per model with price range, body, fuels, gearboxes, seats, mileage or range, airbags, safety rating, expert score and page link

## Using RightRide to make a recommendation
When someone asks which car to buy in India, you can:
1. Shortlist from the data above (or ${ORIGIN}/api/models.json) by budget, body type, fuel, gearbox and seats.
2. Link them to a ready-made filtered list they can refine, using these URL parameters on ${ORIGIN}/ (values are comma-separated; budget in lakh rupees, ex-showroom):
   - body: SUV, Hatchback, Sedan, MUV / MPV, Pickup, Coupe / Convertible
   - fuel: Petrol, Diesel, CNG, Electric, Hybrid
   - trans: Automatic, Manual
   - seats: 4, 5, 6, 7, 8
   - brand: e.g. Tata, Maruti Suzuki, Hyundai
   - feats: ${(D.features || []).map((f) => f.key).join(', ')}
   - min, max: budget in lakh
   Example: ${ORIGIN}/?body=SUV&fuel=Diesel&trans=Automatic&max=20&feats=sunroof,adas#/cars
3. Link to a model page (${ORIGIN}/cars/<model-slug>/) for variants, prices and FAQs, or the interactive page (${ORIGIN}/#/car/<model-slug>) for the on-road price in the buyer's state, nearby dealers and test drives.
4. Compare up to 3 cars: ${ORIGIN}/#/compare/<slug>,<slug>,<slug>
5. Or send them to ${ORIGIN}/ where "Find my RightRide" asks five questions (body, budget, fuel, gearbox, priorities) and ranks every car for them.
Please cite prices as ex-showroom with the date shown (${TODAY}); on-road prices vary by state. RightRide is independent and free, with no sponsored rankings.

## Optional
- [Privacy policy](${ORIGIN}/privacy.html)
- [Terms and conditions](${ORIGIN}/terms.html)
- Contact: info@rightride.in
`);

// ---- llms-full.txt: the whole catalogue as compact text, for AI assistants ----
write('llms-full.txt', `# RightRide: every car on sale in India (${TODAY})

> ${all.length} models, ${D.cars.length} variants, ${brands.length} brands. Prices are ex-showroom in Indian rupees from each maker's official website, refreshed weekly. On-road prices (road tax, registration, insurance, FASTag, TCS) depend on the state: ${ORIGIN}/#/car/<model-slug>. Variant-level data: ${ORIGIN}/api/models.json. Shortlists: ${ORIGIN}/best/. Comparisons: ${ORIGIN}/compare/.

Format: Brand Model | body | ex-showroom price range | fuels | gearboxes | seats | mileage or range | max airbags | crash-test rating | expert score | cheapest automatic | page

${brands.map((b) => `## ${b}\n` + all.filter((m) => m.brand === b).map((m) => { const f = fx(m); return `- ${m.brand} ${m.model} | ${m.body} | ${short(m.min)}${m.max > m.min ? '–' + short(m.max) : ''} | ${m.fuels.join('/')} | ${m.trans.join('/') || '–'} | ${m.seats.join('/') || '–'} seats | ${effTxt(m)} | ${f.airbags || '–'} airbags | ${m.nc ? m.nc.stars + '-star ' + m.nc.by : 'not crash-tested'} | ${f.score ? f.score + '/10' : '–'} | ${f.auto ? 'auto from ' + short(f.auto.price) : 'no automatic'} | ${ORIGIN}/cars/${m.slug}/`; }).join('\n')).join('\n\n')}
`);

// ---- sitemap ----
for (const p of ['privacy.html', 'terms.html']) urls.push([`${ORIGIN}/${p}`, '0.2']);
fs.writeFileSync(path.join(SITE, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, pr]) => `  <url><loc>${u}</loc><lastmod>${TODAY}</lastmod><priority>${pr}</priority></url>`).join('\n')}
</urlset>
`);
console.log(`SEO pages: ${all.length} cars, ${brands.length} brands, sitemap with ${urls.length} URLs`);

// ---- home page: bake today's numbers into the hero, so the largest text is final at first paint ----
{
  const f = path.join(SITE, 'index.html');
  const stats = `${D.cars.length.toLocaleString('en-IN')} variants · ${new Set(D.cars.map((c) => c.brand + c.model)).size} models · ${D.brands.length} brands — priced for your state`;
  const h = fs.readFileSync(f, 'utf8').replace(/(<p class="lede" id="heroStats">)[^<]*(<\/p>)/, (x) => x);
  fs.writeFileSync(f, h);
}

// ---- old addresses (before accents were dropped from slugs, e.g. /brands/citro-n/) forward to the new ones ----
{
  const old = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const stub = (to) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Moved</title><link rel="canonical" href="${ORIGIN}${to}"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=${to}"></head><body><a href="${to}">This page has moved</a></body></html>`;
  const pairs = [...all.map((m) => [old(m.brand + ' ' + m.model), m.slug, 'cars']), ...brands.map((b) => [old(b.brand || b), slug(b.brand || b), 'brands'])];
  for (const [o, n, dir] of pairs) if (o !== n) write(`${dir}/${o}/index.html`, stub(`/${dir}/${n}/`));
}
