export default {
  brand: 'Hyundai',
  origin: 'https://www.hyundai.com/in/en/find-a-car/creta/price',
  async run(opts = {}) {
    const API = 'https://api.hyundai.co.in/service/price/';
    const models = (await RR.fetchJSON(API + 'getModels')).filter((m) => m.enabled && m.price && !/prime/i.test(m.description));
    const slugOf = (d) => d.replace(/^(all\s+)?new\s+/i, '').trim().toLowerCase().replace(/\s+/g, '-').replace('ioniq-5', 'ioniq-5');
    const out = [];
    for (const m of models) {
      if (opts.only && !new RegExp(opts.only, 'i').test(m.description)) continue;
      const slug = slugOf(m.description);
      const model = { model: m.description.replace(/^(all\s+)?new\s+/i, '').trim(), body: m.category, image: 'https://www.hyundai.com/content/dam/hyundai/in/en/data' + (m.imageFileName || ''), url: `https://www.hyundai.com/in/en/find-a-car/${slug}/highlights`, variants: [] };
      // ---- prices per state (one representative city each)
      const states = await RR.fetchJSON(API + 'getStatesByModel?modelId=' + m.id).catch(() => []);
      const priceByState = {}; // code -> rows
      const errs = await RR.pool(states, 4, async (st) => {
        const code = RR.stateCode(st.description);
        if (!code || priceByState[code]) return;
        const cities = await RR.fetchJSON(`${API}getPriceCitiesByModelIdAndStateId?stateId=${st.id}&modelId=${m.id}`);
        if (!cities.length) return;
        const want = (RR.STATE_CITIES[code] || [])[1] || '';
        const city = cities.find((c) => (c.description || c.name || '').toLowerCase().startsWith(want.toLowerCase().slice(0, 5))) || cities[0];
        const rows = await RR.fetchJSON(`${API}getPriceByModelAndCity?cityId=${city.id}&modelId=${m.id}`);
        priceByState[code] = rows;
      });
      errs.filter((e) => e && e.__error).forEach((e) => RR.warn(model.model + ' price: ' + e.__error));
      const baseRows = priceByState.DL || Object.values(priceByState)[0] || [];
      const key = (r) => [r.variant, r.engine, r.transmission, r.fuelType, r.edition, r.paintType].join('|');
      // ---- features by trim
      let trims = [], feats = []; // feats: {group,label, values:[per trim]}
      try {
        const doc = await RR.fetchDoc(`https://www.hyundai.com/in/en/find-a-car/${slug}/features`);
        const og = doc.querySelector('meta[property="og:image"]')?.content;
        if (og) model.image = new URL(og, location.origin).href;
        const tables = [...doc.querySelectorAll('table')];
        for (const t of tables) {
          const rows = RR.tableRows(t);
          if (rows.length < 3) continue;
          const head = rows[0];
          if (!/feature/i.test(head[0])) continue;
          const tHead = head.slice(1);
          if (!trims.length) trims = tHead;
          const group = RR.clean(t.closest('[class*=accordion], section, div')?.querySelector('h2,h3,h4,button,.title')?.textContent || '');
          let lastLabel = '';
          for (const r of rows.slice(1)) {
            // rows may have a leading category cell (rowspan) -> align from the right
            const vals = r.slice(-tHead.length);
            const labelParts = r.slice(0, r.length - tHead.length);
            let label = labelParts.join(' - ') || lastLabel;
            if (labelParts.length === 0) label = lastLabel;
            lastLabel = labelParts[0] || lastLabel;
            feats.push({ group, label, trims: tHead, values: vals });
          }
        }
      } catch (e) { RR.warn('hyundai features ' + slug + ': ' + e); }
      const normT = (s) => String(s).toLowerCase().replace(/\b(dsl|dt|edition)\b/g, '').replace(/[^a-z0-9+()]/g, '');
      const trimIndex = (trims, v) => {
        const nv = normT(v);
        let i = trims.findIndex((t) => normT(t) === nv);
        if (i >= 0) return i;
        let best = -1, bl = 0; // longest header that is a prefix of the variant
        trims.forEach((t, k) => { const nt = normT(t); if (nt && nv.startsWith(nt) && nt.length > bl) { best = k; bl = nt.length; } });
        return best;
      };
      for (const r of baseRows) {
        const prices = {};
        for (const [code, rows] of Object.entries(priceByState)) {
          const hit = rows.find((x) => key(x) === key(r));
          if (hit) prices[code] = RR.num(hit.price);
        }
        const features = [];
        for (const f of feats) {
          const i = trimIndex(f.trims, r.variant);
          if (i < 0) continue;
          features.push({ group: f.group, label: f.label, value: f.values[i] });
        }
        model.variants.push({
          name: RR.clean([r.variant, r.engine, r.transmission, r.edition].filter(Boolean).join(' ')),
          trim: RR.clean(r.variant), fuel: r.fuelType, transmission: r.transmission, engine: r.engine,
          price: RR.num(r.price), priceCity: priceByState.DL ? 'Delhi' : Object.keys(priceByState)[0], prices, features,
        });
      }
      out.push(model);
    }
    return { models: out, log: RR.log };
  },
};
