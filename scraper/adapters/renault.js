export default {
  brand: 'Renault',
  origin: 'https://www.renault.co.in/',
  async run(opts = {}) {
    const home = await RR.fetchDoc('/');
    const slugs = [...new Set([...home.querySelectorAll('a[href*="/cars/renault-"]')].map((a) => (a.getAttribute('href').match(/\/cars\/(renault-[a-z0-9-]+?)(\/configurator)?\.html/) || [])[1]).filter(Boolean))];
    const out = [];
    for (const slug of slugs) {
      if (opts.only && !new RegExp(opts.only, 'i').test(slug)) continue;
      try {
        const html = await RR.fetchText(`/cars/${slug}/configurator.html`);
        const m = html.match(/window\.APP_STATE=JSON\.parse\(("(?:[^"\\]|\\.)*")\)/);
        if (!m) { RR.warn('renault no state ' + slug); continue; }
        const S = JSON.parse(JSON.parse(m[1]));
        const data = S.page?.data?.modelParams?.data || {};
        const st = S.page?.data?.content?.contentZone?.configurator?.staticData || {};
        const engines = {}; for (const e of data.engines || st.engines || []) engines[e.code] = e;
        // cumulative key equipment per grade: usp list ordered by grade level
        const usp = (st.usp || []).map((u) => (u.equipments || []).map((e) => e.label));
        const grades = (data.grades || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const model = { model: slug.replace('renault-', '').replace(/\b\w/g, (c) => c.toUpperCase()), url: `https://www.renault.co.in/cars/${slug}.html`, variants: [] };
        const byPrice = grades.slice().sort((a, b) => (a.startingPrice || 0) - (b.startingPrice || 0));
        byPrice.forEach((g, gi) => {
          const feats = usp.slice(0, gi + 1).flat();
          for (const v of g.versions || []) {
            const gb = v.gearboxTypeCode || '';
            model.variants.push({
              name: RR.clean(v.label), trim: RR.clean(g.label), fuel: { ESS: 'Petrol', DIE: 'Diesel', GPL: 'CNG', ELEC: 'Electric' }[v.mainFuelTypeCode] || v.mainFuelTypeCode,
              transmission: /^BVM/.test(gb) ? 'Manual' : /^BVR/.test(gb) ? 'AMT' : /CVT/.test(gb) ? 'CVT' : /^BVA|EDC/.test(gb) ? 'Automatic' : gb, engine: v.engineName,
              price: v.startingPrice || RR.num(v.minPrice), priceCity: 'Delhi', prices: {}, features: feats.map((l) => ({ group: 'Key features', label: l, value: 'Yes' })),
            });
          }
        });
        out.push(model);
      } catch (e) { RR.warn('renault ' + slug + ': ' + e); }
    }
    return { models: out, log: RR.log };
  },
};
