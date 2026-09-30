export default {
  brand: 'Volkswagen',
  origin: 'https://www.volkswagen.co.in/en.html',
  async run(opts = {}) {
    const home = await RR.fetchDoc('/en/models.html');
    const pages = [...new Set([...home.querySelectorAll('a[href*="/en/models/"]')].map((a) => new URL(a.getAttribute('href'), location.origin).pathname).filter((p) => /^\/en\/models\/[a-z0-9-]+\.html$/.test(p)))];
    const out = [];
    const seenLayer = new Set();
    for (const p of pages) {
      if (opts.only && !new RegExp(opts.only, 'i').test(p)) continue;
      try {
        const doc = await RR.fetchDoc(p);
        const priceLayer = [...doc.querySelectorAll('a[href*="__layer/layers/price/"]')].map((a) => a.getAttribute('href'))[0];
        if (!priceLayer || seenLayer.has(priceLayer.split('/price/')[1])) continue;
        seenLayer.add(priceLayer.split('/price/')[1]);
        const specLayer = [...doc.querySelectorAll('a[href*="__layer/layers/specifications/"]')].map((a) => a.getAttribute('href'))[0];
        const pdoc = await RR.fetchDoc(priceLayer);
        const title = RR.clean(doc.querySelector('meta[property="og:title"]')?.content || doc.title).split('|')[0].replace(/^the new /i, '').trim();
        const specsByEngine = {};
        if (specLayer) {
          const sdoc = await RR.fetchDoc(specLayer);
          for (const t of sdoc.querySelectorAll('table')) {
            const rows = RR.tableRows(t); const head = rows[0] || [];
            for (const r of rows.slice(1)) head.slice(1).forEach((h, i) => { (specsByEngine[h] = specsByEngine[h] || {})[r[0]] = r[i + 1]; });
          }
        }
        const model = { model: title, url: location.origin + p, image: doc.querySelector('meta[property="og:image"]')?.content, variants: [] };
        for (const t of pdoc.querySelectorAll('table')) for (const r of RR.tableRows(t).slice(1)) {
          if (!r[1] || !RR.num(r[1])) continue;
          const name = r[0];
          const eng = Object.keys(specsByEngine).find((k) => name.replace(/\s+/g, '').includes(k.replace(/\s+/g, ''))) || '';
          const specs = specsByEngine[eng] || {};
          model.variants.push({ name, trim: name.split(/\s\d\.\d/)[0], fuel: /TDI|diesel/i.test(name) ? 'Diesel' : /\bEV\b|electric/i.test(name) ? 'Electric' : 'Petrol', transmission: /\bMT\b|manual/i.test(name) ? 'Manual' : 'Automatic', engine: eng, price: RR.num(r[1]), priceCity: 'Delhi', prices: {}, specs, features: [] });
        }
        if (model.variants.length) out.push(model);
      } catch (e) { RR.warn('vw ' + p + ': ' + e); }
    }
    return { models: out, log: RR.log };
  },
};
