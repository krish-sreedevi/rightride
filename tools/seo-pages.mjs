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

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
const page = ({ title, desc, canon, body, jsonld = [], image, track }) => `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canon}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Right Ride"><meta property="og:locale" content="en_IN">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${canon}">
<meta property="og:image" content="${esc(image || ORIGIN + '/brand/og-card.png')}"><meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#D02A1C">
<link rel="icon" type="image/svg+xml" href="/brand/favicon.svg?v=7t"><link rel="apple-touch-icon" href="/brand/app-icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Michroma&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/seo.css">
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head>
<body>
<header class="top"><a href="/" aria-label="Right Ride home"><img class="logo-d" src="/brand/logo-day.svg" alt="Right Ride" width="105" height="34"><img class="logo-n" src="/brand/logo-night.svg" alt="" width="105" height="34"></a>
<nav class="topnav" aria-label="Main"><a href="/cars/">All cars</a><a class="cta" href="/#/cars">Find my Right Ride</a></nav></header>
<main>
${body}
</main>
<footer class="foot"><nav aria-label="Site information"><a href="/cars/">All cars</a><a href="/privacy.html">Privacy policy</a><a href="/terms.html">Terms and conditions</a><a href="mailto:info@rightride.in">info@rightride.in</a></nav>
<p>© ${YEAR} Right Ride. All rights reserved. Prices are ex-showroom from each maker's official website, refreshed every week; confirm with your dealer before booking. Right Ride is independent and not affiliated with any carmaker.</p></footer>
<script src="/analytics.js"></script>
<script>window.rrTrack && window.rrTrack(${JSON.stringify(track)}, document.title);</script>
</body>
</html>
`;
const crumbs = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: url })) });
const crumbHtml = (items) => `<nav class="crumbs" aria-label="Breadcrumb">${items.map(([n, u], i) => (i < items.length - 1 ? `<a href="${u.replace(ORIGIN, '')}">${esc(n)}</a><span aria-hidden="true">›</span>` : `<span aria-current="page">${esc(n)}</span>`)).join('')}</nav>`;
const write = (rel, html) => { const f = path.join(SITE, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); };
const card = (m) => `<a class="car" href="/cars/${m.slug}/"><span class="ci">${m.image ? `<img src="/${esc(m.image)}" alt="${esc(m.brand + ' ' + m.model)}" loading="lazy" width="300" height="175">` : ''}</span><b>${esc(m.brand)} ${esc(m.model)}</b><small>${short(m.min)}${m.max > m.min ? ' – ' + short(m.max) : ''} · ${esc(m.body)}</small></a>`;

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
  const body = `${crumbHtml([['Home', ORIGIN + '/'], ['Cars', ORIGIN + '/cars/'], [m.brand, `${ORIGIN}/brands/${slug(m.brand)}/`], [m.model, canon]])}
<section class="hero">
  <div class="hero-img">${m.image ? `<img src="/${esc(m.image)}" alt="${esc(name)}" width="1200" height="700" fetchpriority="high">` : ''}</div>
  <div class="hero-txt">
    <p class="eyebrow">${esc(m.brand)} · ${esc(m.body)}</p>
    <h1>${esc(name)}</h1>
    <p class="price">${short(m.min)}${m.max > m.min ? ` <span>– ${short(m.max)}</span>` : ''}</p>
    <p class="muted">Ex-showroom price in India. On-road prices for your state include road tax, registration, insurance, FASTag and TCS.</p>
    <p class="actions"><a class="btn primary" href="${app}">See on-road price in your state</a><a class="btn" href="${app}">Compare variants &amp; find dealers</a></p>
  </div>
</section>
<p class="lede">The ${esc(name)} is ${esc(bodyPhrase(m.body))} available with ${esc(list(m.fuels.map((f) => f.toLowerCase())))} power and ${esc(list(m.trans.map((t) => t.toLowerCase())))} gearbox${m.trans.length > 1 ? ' options' : ''}${m.seats.length ? `, seating ${m.seats.join(' or ')}` : ''}. It is sold in ${m.vs.length} variant${m.vs.length > 1 ? 's' : ''}, priced from ${lakh(m.min)}${m.max > m.min ? ` to ${lakh(m.max)}` : ''} ex-showroom${m.nc ? `, and has a ${m.nc.stars}-star ${esc(m.nc.by)} safety rating` : ''}.</p>
<section><h2>${esc(name)} key facts</h2><dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section>
${m.usp.length ? `<section><h2>Why people pick the ${esc(m.model)}</h2><ul class="ticks">${m.usp.map((u) => `<li>${esc(u)}</li>`).join('')}</ul></section>` : ''}
${m.x && (m.x.like || m.x.dislike) ? `<section><h2>Expert verdict</h2><div class="two"><div><h3>Likes</h3><ul class="ticks">${(m.x.like || []).map((u) => `<li>${esc(u)}</li>`).join('')}</ul></div><div><h3>Dislikes</h3><ul class="crosses">${(m.x.dislike || []).map((u) => `<li>${esc(u)}</li>`).join('')}</ul></div></div>${m.x.url ? `<p class="muted small">From the <a href="${esc(m.x.url)}" rel="noopener" target="_blank">Autocar India review</a>.</p>` : ''}</section>` : ''}
<section><h2>${esc(name)} variants and prices</h2>
<div class="scroll"><table><thead><tr><th>Variant</th><th>Fuel</th><th>Gearbox</th><th class="n">Ex-showroom</th></tr></thead><tbody>
${m.vs.map((v) => `<tr><td>${esc(v.variant)}</td><td>${esc(v.fuel)}</td><td>${esc(v.transmission || '–')}${v.transType && v.transType !== v.transmission ? ` <small>(${esc(v.transType)})</small>` : ''}</td><td class="n">${short(v.price)}</td></tr>`).join('\n')}
</tbody></table></div>
<p class="muted small">Prices from ${esc(m.brand)}'s official website${m.vs[0].priceCity ? ` (${esc(m.vs[0].priceCity)})` : ''}, updated ${esc(TODAY)}. <a href="${app}">Find the variant with the features you want →</a></p></section>
${(m.e.colors || []).length ? `<section><h2>${esc(name)} colours</h2><p>${esc(list(m.e.colors.map((c) => c.name)))}.</p></section>` : ''}
${similar.length ? `<section><h2>Similar cars to the ${esc(m.model)}</h2><div class="cars">${similar.map(card).join('')}</div><p><a href="/#/compare/${[m, ...similar.slice(0, 2)].map((o) => o.slug).join(',')}">Compare the ${esc(m.model)} with the ${esc(similar.slice(0, 2).map((o) => o.model).join(' and '))} →</a></p></section>` : ''}
<section class="more"><h2>More from ${esc(m.brand)}</h2><p><a href="/brands/${slug(m.brand)}/">All ${esc(m.brand)} cars and prices →</a></p></section>`;
  const jsonld = [
    crumbs([['Home', ORIGIN + '/'], ['Cars', ORIGIN + '/cars/'], [m.brand, `${ORIGIN}/brands/${slug(m.brand)}/`], [m.model, canon]]),
    { '@context': 'https://schema.org', '@type': 'Car', name, brand: { '@type': 'Brand', name: m.brand }, model: m.model, bodyType: m.body, fuelType: m.fuels.join(', '), vehicleTransmission: m.trans.join(', '), ...(m.seats.length ? { seatingCapacity: Math.max(...m.seats) } : {}), ...(m.image ? { image: abs(m.image) } : {}), url: canon, description: desc },
  ];
  write(`cars/${m.slug}/index.html`, page({ title: `${name} Price ${YEAR}, Variants, Mileage & Features | Right Ride`, desc, canon, body, jsonld, image: m.image ? abs(m.image) : null, track: `/seo/car/${m.slug}` }));
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
  write(`brands/${slug(b)}/index.html`, page({ title: `${b} Cars in India ${YEAR}: Prices, Models & Variants | Right Ride`, desc, canon, body, jsonld: [crumbs([['Home', ORIGIN + '/'], ['Cars', ORIGIN + '/cars/'], [b, canon]])], track: `/seo/brand/${slug(b)}` }));
  urls.push([canon, '0.7']);
}

// ---- all cars ----
{
  const canon = `${ORIGIN}/cars/`;
  const body = `${crumbHtml([['Home', ORIGIN + '/'], ['Cars', canon]])}
<h1>New cars in India ${YEAR}</h1>
<p class="lede">Every new car on sale in India: ${all.length} models and ${D.cars.length} variants from ${brands.length} brands, with ex-showroom prices from each maker's official website. <a href="/#/cars">Filter them by budget and features, and see on-road prices for your state →</a></p>
<nav class="brandnav" aria-label="Brands">${brands.map((b) => `<a href="#${slug(b)}">${esc(b)}</a>`).join('')}</nav>
${brands.map((b) => `<section id="${slug(b)}"><h2><a href="/brands/${slug(b)}/">${esc(b)}</a></h2><div class="cars">${all.filter((m) => m.brand === b).map(card).join('')}</div></section>`).join('\n')}`;
  write('cars/index.html', page({ title: `New Cars in India ${YEAR}: Prices, Variants & Features of Every Model | Right Ride`, desc: `Compare all ${all.length} new car models on sale in India from ${brands.length} brands: ex-showroom prices, variants, mileage, safety ratings and features.`, canon, body, jsonld: [crumbs([['Home', ORIGIN + '/'], ['Cars', canon]])], track: '/seo/cars' }));
}

// ---- sitemap ----
for (const p of ['privacy.html', 'terms.html']) urls.push([`${ORIGIN}/${p}`, '0.2']);
fs.writeFileSync(path.join(SITE, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, pr]) => `  <url><loc>${u}</loc><lastmod>${TODAY}</lastmod><priority>${pr}</priority></url>`).join('\n')}
</urlset>
`);
console.log(`SEO pages: ${all.length} cars, ${brands.length} brands, sitemap with ${urls.length} URLs`);
