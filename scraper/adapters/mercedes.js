export default {
  brand: 'Mercedes-Benz',
  origin: 'https://www.mercedes-benz.co.in/passengercars/models.html?group=all',
  async run(opts = {}) {
    const API = 'https://api.oneweb.mercedes-benz.com/';
    const live = await RR.fetchJSON(API + 'vmos-api/v1/data/IN/en/OWF/live');
    const out = [];
    const cards = Object.values(live.cards || {});
    const vd = live.vehiclesData || {};
    const done = new Set();
    for (const card of cards) {
      const v = vd[card.vehicleDataId];
      if (!v || done.has(card.vehicleDataId)) continue;
      done.add(card.vehicleDataId);
      if (opts.only && !new RegExp(opts.only, 'i').test(v.name)) continue;
      let hl = null;
      try { hl = await RR.fetchJSON(`${API}vmds-highlights-api/v1/highlights/IN/en/${card.modelSeries}`); } catch (e) { RR.warn('mb hl ' + card.modelSeries); }
      const H = (k) => hl?.highlights?.[k];
      const seats = RR.num(H('SEATS')?.max);
      const cc = RR.num(H('COMBUSTION_ENGINE_CUBIC_CAPACITY')?.min);
      const body = { saloon: 'Sedan', 'saloon-long': 'Sedan', offroader: 'SUV', coupe: 'Coupe / Convertible', cabriolet: 'Coupe / Convertible', roadster: 'Coupe / Convertible', hatchback: 'Hatchback', 'people-carrier': 'MUV / MPV' }[v.bodytypeId] || 'SUV';
      const model = { model: RR.clean(v.name), body, url: card.ctas?.PRODUCT_PAGE?.url, image: (card.vehicleImages || [])[0], variants: [] };
      const filters = v.technicalData?.priceData?.all?.filters || {};
      const drive = (hl?.driveTrainTypes || []).includes('AWD') ? 'AWD' : '';
      const entries = Object.entries(filters).length ? Object.entries(filters) : [['', v.technicalData?.priceData?.all]];
      for (const [fuel, p] of entries) {
        if (!p?.value) continue;
        const f = ({ PETROL: 'Petrol', PETROL_PLUS: 'Petrol', DIESEL: 'Diesel', ELECTRIC: 'Electric', PHEV: 'PHEV', HYBRID: 'Hybrid' })[fuel] || ((card.tags || []).includes('electric') ? 'Electric' : 'Petrol');
        model.variants.push({ name: `${model.model} ${f}`.trim(), trim: f, fuel: f, transmission: 'Automatic', drive, seats, engine: cc ? cc + ' cc' : '', price: p.value, priceCity: 'Delhi', prices: {}, features: [], specs: { 'Top speed': H('TOP_SPEED')?.max, Boot: H('BOOT_CAPACITY')?.min } });
      }
      if (model.variants.length) out.push(model);
    }
    return { models: out, log: RR.log };
  },
};
