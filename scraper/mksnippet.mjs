// Build a paste-able snippet for testing an adapter in a browser devtools/pane.
import fs from 'fs';
const [,, brand, optsJson = '{}', summarize = '1'] = process.argv;
const helpers = fs.readFileSync(new URL('./helpers.js', import.meta.url), 'utf8');
const ad = fs.readFileSync(new URL(`./adapters/${brand}.js`, import.meta.url), 'utf8').replace('export default', 'const A =');
const sum = summarize === '1' ? `
const s = res.models.map(m => ({model: m.model, n: m.variants.length, v0: m.variants[0] && {...m.variants[0], features: (m.variants[0].features||[]).length, featSample: (m.variants[0].features||[]).slice(0,4)}}));
JSON.stringify({log: res.log, s}).slice(0, 6000)` : 'window.__res = res; JSON.stringify(res).length';
process.stdout.write(`${helpers}\n${ad}\nconst res = await A.run(${optsJson});\n${sum}`);
