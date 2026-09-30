import fs from 'fs'; import { minify } from 'terser';
const [,, brand, opts='{}'] = process.argv;
const helpers = fs.readFileSync('scraper/helpers.js','utf8');
const { default: ad } = await import(process.cwd()+`/scraper/adapters/${brand}.js`);
const src = ad.run.toString(); const expr = src.startsWith('async run') ? 'async function '+src.slice(6) : src;
const code = `${helpers}\nwindow.__res=null;window.__err=null;(${expr})(${opts}).then(r=>window.__res=r).catch(e=>window.__err=String(e));'started'`;
const m = await minify(code, { compress: false, mangle: true, format: { comments: false } });
process.stdout.write(m.code);
