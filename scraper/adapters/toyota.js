export default {
  brand: 'Toyota',
  origin: 'https://www.toyotabharat.com/pricelist/',
  async run(opts = {}) {
    const API = 'https://webapi.toyotabharat.com/1.0/api/';
    const x = async (p) => new DOMParser().parseFromString(await RR.fetchText(API + p, { method: 'POST' }), 'text/xml');
    const txt = (el, sel) => RR.clean(el.querySelector(sel)?.textContent);
    const kids = (doc, tag) => [...doc.documentElement.children].filter((e) => e.tagName === tag);
    const models = kids(await x('price/models'), 'PriceModel').map((m) => ({ id: txt(m, ':scope > Id'), name: txt(m, ':scope > Name') })).filter((m) => m.id && m.name);
    const states = kids(await x('pricestates'), 'State').map((s) => ({ id: txt(s, ':scope > Id'), name: txt(s, ':scope > Name') }));
    // one dealer per state (prefer representative city)
    const dealerByState = {};
    await RR.pool(states, 4, async (s) => {
      const code = RR.stateCode(s.name);
      if (!code) return;
      const cities = kids(await x(`pricestates/${s.id}/pricecities`), 'City').map((c) => ({ id: txt(c, ':scope > Id'), name: txt(c, ':scope > Name') }));
      const want = (RR.STATE_CITIES[code] || [])[1] || '';
      const order = [...cities.filter((c) => c.name.toLowerCase().startsWith(want.toLowerCase().slice(0, 4))), ...cities];
      for (const c of order.slice(0, 4)) {
        const d = kids(await x(`businesscities/${c.id}/websalesdealers`), 'Dealer')[0];
        if (d) { dealerByState[code] = txt(d, ':scope > Id'); break; }
      }
    });
    const out = [];
    for (const m of models) {
      if (opts.only && !new RegExp(opts.only, 'i').test(m.name)) continue;
      const byState = {};
      await RR.pool(Object.entries(dealerByState), 4, async ([code, dealer]) => {
        const doc = await x(`price/list/${dealer}/${m.id}`);
        const FU = { P: 'Petrol', D: 'Diesel', C: 'CNG', H: 'Hybrid', E: 'Electric', S: 'Hybrid' };
        const rows = [...doc.getElementsByTagName('Price')].map((p) => {
          const g = p.querySelector('PriceGrade');
          return { grade: txt(g, ':scope > Name'), fuel: FU[txt(g, ':scope > FuelType')] || txt(g, ':scope > FuelType'), summary: txt(g, ':scope > Details'), price: RR.num(txt(p, ':scope > Amount')) };
        }).filter((r) => r.grade && r.price);
        if (rows.length) byState[code] = rows;
      });
      const base = byState.DL || byState.KA || Object.values(byState)[0];
      if (!base) { RR.warn('toyota no prices ' + m.name); continue; }
      const model = { model: m.name, url: 'https://www.toyotabharat.com/showroom/', variants: [] };
      const canon = (g) => RR.clean(g.replace(/\[[^\]]*(white|pearl|black|red|blue|silver|grey|gray|green|roof|brown|bronze|colou?r)[^\]]*\]/gi, '').replace(/\(Int\.? Colou?r[^)]*\)/gi, ''));
      const groups = {};
      for (const [code, rows] of Object.entries(byState)) for (const r of rows) {
        const k = canon(r.grade) + '|' + r.fuel;
        const g = (groups[k] = groups[k] || { name: canon(r.grade), fuel: r.fuel, transmission: r.summary, prices: {} });
        if (!g.prices[code] || r.price < g.prices[code]) g.prices[code] = r.price;
      }
      for (const g of Object.values(groups)) {
        model.variants.push({ name: g.name, trim: g.name, fuel: g.fuel, transmission: g.transmission, engine: '', price: g.prices.DL || Object.values(g.prices)[0], priceCity: g.prices.DL ? 'Delhi' : '', prices: g.prices, features: [] });
      }
      out.push(model);
    }
    return { models: out, log: RR.log };
  },
};
