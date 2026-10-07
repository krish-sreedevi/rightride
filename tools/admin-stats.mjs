// Builds site/data/admin-stats.enc.json for the admin portal (admin.html).
// Runs in the "Deploy site" GitHub workflow. It pulls usage numbers from GoatCounter and Google Analytics 4
// with tokens kept as GitHub secrets, then encrypts the result with the admin username + password, so the
// public site never contains a token or readable stats. Nothing secret is ever printed.
//
// Secrets (Settings -> Secrets and variables -> Actions):
//   ADMIN_USER, ADMIN_PASS  sign-in for admin.html (required; without them nothing is written)
//   GC_TOKEN                GoatCounter API token with "Read statistics" permission (optional)
//   GA_SA_KEY               Google Cloud service-account key (the whole JSON file) with Viewer access to the GA4 property (optional)
//   GA_PROPERTY_ID          numeric GA4 property ID, e.g. 512345678 (optional, needed with GA_SA_KEY)
import { webcrypto as C, createSign } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';

const E = process.env;
const GC_CODE = E.GC_CODE || 'rightride';
const PERIODS = [7, 30, 90, 365];
const day = (d) => d.toISOString().slice(0, 10);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const log = (...a) => console.log('[admin-stats]', ...a);

// ---------- GoatCounter ----------
async function gc(path, params) {
  const u = new URL(`https://${GC_CODE}.goatcounter.com/api/v0/${path}`);
  for (const [k, v] of Object.entries(params || {})) if (v != null && v !== '') u.searchParams.set(k, v);
  for (let i = 0; i < 6; i++) {
    const r = await fetch(u, { headers: { Authorization: 'Bearer ' + E.GC_TOKEN, 'Content-Type': 'application/json' } });
    if (r.status === 429) { await sleep(1500 * (i + 1)); continue; }
    if (!r.ok) throw new Error(`GoatCounter ${path}: HTTP ${r.status}`);
    return r.json();
  }
  throw new Error('GoatCounter: rate limited');
}
async function gcPeriod(days) {
  const end = new Date(), start = new Date(Date.now() - (days - 1) * 864e5);
  const range = { start: day(start) + 'T00:00:00Z', end: day(end) + 'T23:59:59Z' };
  const tot = await gc('stats/total', range);
  const hits = []; let exclude = [];
  for (let page = 0; page < 20; page++) {
    const j = await gc('stats/hits', { ...range, limit: 100, exclude_paths: exclude.join(',') });
    hits.push(...(j.hits || []).map((h) => ({ path: h.path, path_id: h.path_id, title: h.title, event: h.event, count: h.count })));
    if (!j.more || !(j.hits || []).length) break;
    exclude = hits.map((h) => h.path_id);
  }
  const ref = await gc('stats/toprefs', { ...range, limit: 20 }).catch(() => null);
  const sizes = await gc('stats/sizes', { ...range, limit: 10 }).catch(() => null);
  const loc = await gc('stats/locations', { ...range, limit: 15 }).catch(() => null);
  const pick = (j) => (j && j.stats ? j.stats.map((s) => [s.name || '(unknown)', s.count]) : []);
  return { range, tot: { total: tot.total, total_events: tot.total_events, stats: (tot.stats || []).map((s) => ({ day: s.day, daily: s.daily })) }, hits, refs: pick(ref), sizes: pick(sizes), locations: pick(loc) };
}

// ---------- Google Analytics 4 (Data API, service account) ----------
const b64u = (b) => Buffer.from(b).toString('base64url');
async function gaToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/analytics.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3000 }));
  const sig = createSign('RSA-SHA256').update(head + '.' + body).sign(key.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${sig}` }) });
  if (!r.ok) throw new Error('Google sign-in failed: HTTP ' + r.status);
  return (await r.json()).access_token;
}
async function gaReport(tok, body) {
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${E.GA_PROPERTY_ID}:runReport`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('GA report: HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200).replace(/\s+/g, ' '));
  const j = await r.json();
  return (j.rows || []).map((row) => [...(row.dimensionValues || []).map((d) => d.value), ...(row.metricValues || []).map((m) => +m.value)]);
}
async function gaPeriod(tok, days) {
  const dateRanges = [{ startDate: `${days - 1}daysAgo`, endDate: 'today' }];
  const top = (dim, metric, limit = 12) => gaReport(tok, { dateRanges, dimensions: [{ name: dim }], metrics: [{ name: metric }], orderBys: [{ metric: { metricName: metric }, desc: true }], limit });
  const [tot] = await gaReport(tok, { dateRanges, metrics: ['activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'averageSessionDuration', 'engagementRate'].map((name) => ({ name })) });
  const daily = await gaReport(tok, { dateRanges, dimensions: [{ name: 'date' }], metrics: [{ name: 'activeUsers' }], orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 400 });
  const [pages, channels, sources, cities, devices, events] = await Promise.all([
    top('pageTitle', 'screenPageViews', 15), top('sessionDefaultChannelGroup', 'sessions'), top('sessionSource', 'sessions'),
    top('city', 'activeUsers', 15), top('deviceCategory', 'activeUsers', 5), top('eventName', 'eventCount', 20),
  ]);
  const [users, newUsers, sessions, views, avgSec, engagement] = tot || [0, 0, 0, 0, 0, 0];
  return { totals: { users, newUsers, sessions, views, avgSec, engagement }, daily: daily.map(([d, v]) => ({ day: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, v })), pages, channels, sources, cities, devices, events };
}

// ---------- encrypt with the admin sign-in (matches admin.html) ----------
const SALT = 'rightride-admin-v1', ITER = 600000;
async function encrypt(obj) {
  const pw = await C.subtle.importKey('raw', new TextEncoder().encode(`${E.ADMIN_USER.trim().toLowerCase()}\n${E.ADMIN_PASS}`), 'PBKDF2', false, ['deriveKey']);
  const key = await C.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(SALT), iterations: ITER }, pw, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = C.getRandomValues(new Uint8Array(12));
  const ct = await C.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { v: 1, salt: SALT, iter: ITER, iv: Buffer.from(iv).toString('base64'), ct: Buffer.from(ct).toString('base64') };
}

if (!E.ADMIN_USER || !E.ADMIN_PASS) { log('ADMIN_USER / ADMIN_PASS not set, skipping'); process.exit(0); }
const out = { built: new Date().toISOString(), gc: { code: GC_CODE, connected: !!E.GC_TOKEN, periods: {} }, ga: { id: 'G-B102KX5D7F', property: E.GA_PROPERTY_ID || '', connected: !!(E.GA_SA_KEY && E.GA_PROPERTY_ID), periods: {} } };
if (E.GC_TOKEN) {
  try { for (const d of PERIODS) out.gc.periods[d] = await gcPeriod(d); log('GoatCounter ok'); } catch (e) { out.gc.error = e.message; log('GoatCounter failed:', e.message); }
}
if (out.ga.connected) {
  try {
    const tok = await gaToken(JSON.parse(E.GA_SA_KEY));
    for (const d of PERIODS) out.ga.periods[d] = await gaPeriod(tok, d);
    log('Google Analytics ok');
  } catch (e) { out.ga.error = e.message.replace(/[A-Za-z0-9_\-.]{40,}/g, '…'); log('Google Analytics failed:', out.ga.error); }
}
mkdirSync('site/data', { recursive: true });
writeFileSync('site/data/admin-stats.enc.json', JSON.stringify(await encrypt(out)));
log('wrote site/data/admin-stats.enc.json');
