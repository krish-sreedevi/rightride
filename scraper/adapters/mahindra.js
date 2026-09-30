export default {
  brand: 'Mahindra',
  origin: 'https://auto.mahindra.com/own-online/variant-selection?pid=X7XO',
  async run(opts = {}) {
    const PV = '/on/demandware.store/Sites-amc-Site/en_IN/Product-Variation';
    let pids = [...new Set([...document.querySelectorAll('a[href*="variant-selection?pid="]')].map((a) => a.href.split('pid=')[1].split('&')[0]))];
    if (!pids.length) pids = ['THRN', 'SCN', 'X7XO', 'TH5D', 'X3XO', 'SCRC', 'NEO', 'BOL', 'NEOP', 'X400'];
    const out = [];
    for (const pid of pids) {
      try {
        let base = null;
        for (const f of ['DIESEL', 'PETROL', 'ELECTRIC', 'CNG']) {
          base = await RR.fetchJSON(`${PV}?pid=${pid}&dwvar_${pid}_fuelType=${f}&quantity=1`).catch(() => null);
          if (base?.product) break;
        }
        if (!base?.product) { RR.warn('mahindra no base ' + pid); continue; }
        const p = base.product;
        if (opts.only && !new RegExp(opts.only, 'i').test(p.productName)) continue;
        const attrs = {};
        for (const va of p.variationAttributes || []) attrs[va.id] = va.values.map((v) => v.value);
        const dims = ['fuelType', 'gearBoxType', 'seatingCapacity', 'driveType', 'engineType'].filter((k) => attrs[k] && attrs[k].length);
        const combos = dims.reduce((acc, k) => acc.flatMap((c) => attrs[k].map((v) => ({ ...c, [k]: v }))), [{}]);
        const model = { model: RR.clean(p.productName), url: p.selectedProductUrl || `https://auto.mahindra.com/own-online/variant-selection?pid=${pid}`, image: p.images?.large?.[0]?.absURL, variants: [] };
        const seen = new Set();
        await RR.pool(combos, 3, async (c) => {
          const qs = Object.entries(c).map(([k, v]) => `dwvar_${pid}_${k}=${encodeURIComponent(v)}`).join('&');
          const j = await RR.fetchJSON(`${PV}?pid=${pid}&${qs}&quantity=1`);
          const d = new DOMParser().parseFromString(j.product.variantCardHtml || '', 'text/html');
          for (const e of d.querySelectorAll('[data-variantname]')) {
            const code = e.dataset.attrValue;
            if (seen.has(code)) continue; seen.add(code);
            model.variants.push({
              name: RR.clean(e.dataset.variantname), trim: RR.clean(e.dataset.variantname).split(' ')[0], fuel: c.fuelType ? c.fuelType[0] + c.fuelType.slice(1).toLowerCase() : '',
              transmission: c.gearBoxType ? c.gearBoxType[0] + c.gearBoxType.slice(1).toLowerCase() : '', seats: RR.num(c.seatingCapacity), drive: /AWD|4X4|4WD/i.test(e.dataset.variantname) ? 'AWD/4x4' : (c.driveType || ''),
              engine: '', price: RR.num(e.dataset.priceobj), priceCity: 'Delhi', prices: {}, features: [], code,
            });
          }
        });
        if (model.variants.length) out.push(model); else RR.warn('mahindra no variants ' + pid);
      } catch (e) { RR.warn('mahindra ' + pid + ': ' + e); }
    }
    return { models: out, log: RR.log };
  },
};
