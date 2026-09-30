export default {
  brand: 'Nissan',
  origin: 'https://www.nissan.in/prices-list.html',
  async run(opts = {}) {
    const doc = await RR.fetchDoc('/prices-list.html');
    const byModel = {};
    for (const t of doc.querySelectorAll('table')) for (const r of RR.tableRows(t).slice(1)) {
      if (!r[1] || !(RR.num(r[1]) > 300000)) continue;
      const name = r[0].replace(/^(new\s+)?nissan\s+/i, '').replace(/\s+/g, ' ');
      const m = name.match(/^(x-trail|magnite|gravite|tekton|kicks|terrano|sunny)\b/i);
      if (!m) continue;
      const model = m[1].toLowerCase() === 'x-trail' ? 'X-Trail' : m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
      if (opts.only && !new RegExp(opts.only, 'i').test(model)) continue;
      const mm = (byModel[model] = byModel[model] || { model, url: 'https://www.nissan.in/vehicles/new/nissan-' + model.toLowerCase() + '.html', variants: [] });
      if (mm.variants.some((v) => v.name === name)) continue;
      mm.variants.push({ name, trim: name.replace(new RegExp('^' + model + '\\s*', 'i'), ''), fuel: /cng/i.test(name) ? 'CNG' : /e-power|hybrid/i.test(name) ? 'Hybrid' : 'Petrol', transmission: /\b(MT)\b/i.test(name) ? 'Manual' : /(CVT|AMT|DCT|AT|EZ-SHIFT)\b/i.test(name) ? 'Automatic' : '', engine: '', price: RR.num(r[1]), priceCity: 'Delhi', prices: {}, features: [] });
    }
    return { models: Object.values(byModel), log: RR.log };
  },
};
