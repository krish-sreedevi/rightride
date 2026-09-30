// Runs brand adapters inside a real Chromium page (Playwright) and writes data/raw/<brand>.json
// Usage: node scraper/run.mjs [brand ...] [--only=regex]
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7) || undefined;
const all = fs.readdirSync(path.join(ROOT, 'scraper/adapters')).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3));
const brands = args.filter((a) => !a.startsWith('--'));
const todo = brands.length ? brands : all;
const helpers = fs.readFileSync(path.join(ROOT, 'scraper/helpers.js'), 'utf8');
fs.mkdirSync(path.join(ROOT, 'data/raw'), { recursive: true });

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
const summary = [];

for (const b of todo) {
  const t0 = Date.now();
  const { default: ad } = await import(path.join(ROOT, 'scraper/adapters', b + '.js'));
  const ctx = await browser.newContext({ userAgent: UA, locale: 'en-IN', timezoneId: 'Asia/Kolkata', viewport: { width: 1366, height: 900 }, bypassCSP: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  let result, error;
  try {
    await page.goto(ad.origin, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(ad.settle || 3000);
    await page.evaluate(helpers);
    const fnSrc = ad.run.toString();
    // turn "async run(opts) {...}" method into an async function expression
    const expr = fnSrc.startsWith('async run') ? 'async function ' + fnSrc.slice(6) : fnSrc;
    result = await page.evaluate(`(${expr})(${JSON.stringify({ only, ...(ad.opts || {}) })})`);
  } catch (e) {
    error = String(e).slice(0, 2000);
  }
  await ctx.close();
  const nV = result ? result.models.reduce((s, m) => s + m.variants.length, 0) : 0;
  const rec = { brand: ad.brand, key: b, models: result ? result.models.length : 0, variants: nV, seconds: Math.round((Date.now() - t0) / 1000), error, log: result?.log?.slice(0, 50) };
  summary.push(rec);
  console.log(JSON.stringify(rec));
  if (result && nV > 0 && !only) {
    fs.writeFileSync(path.join(ROOT, 'data/raw', b + '.json'), JSON.stringify({ brand: ad.brand, scrapedAt: new Date().toISOString(), source: ad.origin, ...result }, null, 1));
  }
}
await browser.close();
fs.writeFileSync(path.join(ROOT, 'data/raw/_summary.json'), JSON.stringify({ at: new Date().toISOString(), summary }, null, 1));
