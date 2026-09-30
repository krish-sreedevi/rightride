export default {
  brand: 'Skoda',
  origin: 'https://skodapeaceofmind.co.in/Skoda_TCD/checkprice/checkprice.aspx',
  async run(opts = {}) {
    const models = [...document.querySelectorAll('#drpModels option')].map((o) => o.textContent.trim()).filter((t) => t && !/select/i.test(t));
    const out = [];
    for (const m of models) {
      if (opts.only && !new RegExp(opts.only, 'i').test(m)) continue;
      const model = { model: m, url: 'https://www.skoda-auto.co.in/models/' + m.toLowerCase().replace(/\s+rs$/, '-rs').replace(/\s+/g, '-'), variants: [] };
      for (const fuel of ['Petrol', 'Diesel']) for (const tr of ['Manual', 'Automatic']) {
        const j = await RR.fetchJSON('./CheckPrice.aspx/GetPrice', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ selectedModel: m, fuelType: fuel, transmissionType: tr }) }).catch(() => ({ d: [] }));
        for (const r of j.d || []) {
          if (model.variants.some((v) => v.name === r.Variant)) continue;
          model.variants.push({ name: RR.clean(r.Variant), trim: RR.clean(r.Variant).split(' ')[0], fuel, transmission: tr, engine: (r.Variant.match(/\d\.\d\s*TSI|\d\.\d\s*TDI/i) || [''])[0], price: RR.num(r.ExshowroomPrice), priceCity: 'Delhi', prices: {}, features: [] });
        }
      }
      if (model.variants.length) out.push(model); else RR.warn('skoda no variants ' + m);
    }
    return { models: out, log: RR.log };
  },
};
