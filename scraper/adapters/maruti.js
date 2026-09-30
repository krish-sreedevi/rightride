export default {
  brand: 'Maruti Suzuki',
  origin: 'https://www.marutisuzuki.com/arena/swift/price',
  async run(opts = {}) {
    const nexa = location.host.includes('nexa');
    const channel = nexa ? 'EXC' : 'NRM';
    const cmpQ = nexa ? 'VariantDetailCompare' : 'ArenaVariantDetailCompare';
    const G = '/graphql/execute.json/msil-platform/';
    const P = '/pricing/v2/common/pricing/ex-showroom-detail?variantInfoRequired=true&channel=' + channel + '&forCode=';
    // representative forCode per state
    const cities = (await RR.fetchJSON('/dms/v1/api/common/msil/dms/dealer-only-cities?channel=' + channel)).data || [];
    const forCodes = {};
    for (const [code, [stateName, city]] of Object.entries(RR.STATE_CITIES)) {
      const inState = cities.filter((c) => RR.stateCode(c.stateDesc) === code);
      const pick = inState.find((c) => c.cityDesc.toLowerCase().startsWith(city.toLowerCase().slice(0, 5))) || inState[0];
      if (pick) forCodes[code] = pick.forCode;
    }
    if (!forCodes.DL) forCodes.DL = '08';
    const priceByState = {};
    await RR.pool(Object.entries(forCodes), 4, async ([code, fc]) => {
      const j = await RR.fetchJSON(P + fc);
      const map = {};
      for (const m of j.data?.models || []) for (const v of m.exShowroomDetailResponseDTOList || []) {
        if (!map[v.variantCd] || v.exShowroomPrice < map[v.variantCd]) map[v.variantCd] = v.exShowroomPrice;
      }
      priceByState[code] = { map, models: j.data?.models || [] };
    });
    const base = priceByState.DL || Object.values(priceByState)[0];
    const words = (k) => k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
    const out = [];
    for (const pm of base.models) {
      const cd = pm.modelCd;
      if (opts.only && !new RegExp(opts.only, 'i').test(pm.modelDesc)) continue;
      try {
        const cmp = await RR.fetchJSON(`${G}${cmpQ};modelCd=${cd};channel=${channel};locale=en;`);
        const fl = await RR.fetchJSON(`${G}VariantFeaturesList;modelCd=${cd};locale=en;`).catch(() => null);
        const flItem = fl?.data?.carModelList?.items?.[0];
        const summary = {};
        for (const v of flItem?.variants || []) summary[v.variantCd] = v;
        const item = cmp.data.carModelList.items[0];
        const name = flItem?.modelDesc || pm.modelDesc.replace(/^(dazzling |epic |new |all new )+/i, '');
        const model = { model: name.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/Xl6/i, 'XL6'), url: location.origin + (nexa ? '/' : '/arena/') + name.toLowerCase().replace(/\s+/g, '-'), variants: [] };
        for (const v of item.variants || []) {
          const features = []; const specs = {};
          for (const cat of v.specificationCategory || []) for (const asp of cat.specificationAspect || []) {
            for (const [k, val] of Object.entries(asp)) {
              if (k.startsWith('_') || k === 'categoryLabel' || val == null || typeof val === 'object') continue;
              if (/technical/i.test(cat.categoryName)) specs[words(k)] = RR.clean(val);
              else features.push({ group: asp.categoryLabel, label: words(k), value: RR.clean(val) });
            }
          }
          const s = summary[v.variantCd] || {};
          const sAsp = (s.specificationCategory || []).flatMap((c) => c.specificationAspect || []);
          const get = (k) => sAsp.map((a) => a[k]).find((x) => x);
          const prices = {};
          for (const [code, ps] of Object.entries(priceByState)) if (ps.map[v.variantCd]) prices[code] = ps.map[v.variantCd];
          model.variants.push({
            name: RR.clean(v.variantName || v.variantDesc), trim: RR.clean(v.variantName || v.variantDesc),
            fuel: (v.variantTechnology || [])[0] || get('fuelType') || s.fuelType || '', transmission: v.transmission || get('transmissionType') || '',
            engine: get('displacement') || specs['Displacement'] || '', mileage: get('fuelEfficiency'), seats: RR.num(get('seatingCapacity')),
            price: prices.DL || Object.values(prices)[0] || null, priceCity: prices.DL ? 'Delhi' : '', prices, specs, features,
            image: v.variantImage?._publishUrl,
          });
        }
        out.push(model);
      } catch (e) { RR.warn('maruti ' + cd + ': ' + e); }
    }
    return { models: out, log: RR.log };
  },
};
