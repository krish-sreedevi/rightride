export default {
  brand: 'Honda',
  origin: 'https://www.hondacarindia.com/check-price',
  async run(opts = {}) {
    const nd = (doc) => JSON.parse(doc.getElementById('__NEXT_DATA__').textContent).props.pageProps;
    const cars = (await RR.fetchJSON('/api/getAllCarsData')).data || [];
    const price = async (carID, city, fuelType, transmission, variant) => {
      const j = await RR.fetchJSON('/api/getCarPrice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ carID, city, fuelType, transmission, variant }) });
      const p = j?.data?.[0];
      return p && Number(p.P_Price) > 0 ? Number(p.P_Price) : null;
    };
    // city name per state as Honda spells it
    const states = (await RR.fetchJSON('/api/getAllStates')).data || [];
    const cityByState = {};
    await RR.pool(states, 4, async (s) => {
      const code = RR.stateCode(s.St_Name);
      if (!code || cityByState[code]) return;
      const cities = (await RR.fetchJSON('/api/getAllCities?stateId=' + s.St_ID_pk)).data || [];
      const want = (RR.STATE_CITIES[code] || [])[1] || '';
      const c = cities.find((c) => c.cd_Name.toLowerCase().startsWith(want.toLowerCase().slice(0, 4))) || cities[0];
      if (c) cityByState[code] = c.cd_Name;
    });
    const out = [];
    for (const car of cars) {
      if (opts.only && !new RegExp(opts.only, 'i').test(car.carModelSiteUrl)) continue;
      try {
        const pp = nd(await RR.fetchDoc(`/${car.carModelSiteUrl}/tech-specs`));
        const tns = pp.techAndSpecsData || [];
        const fdata = tns.find((t) => t.TnSTypeName === 'feature') || tns[0];
        const sdata = tns.find((t) => t.TnSTypeName !== 'feature');
        const trims = fdata?.TnSCarModels || [car.carModelVarient];
        const featRows = [];
        for (const grp of fdata?.TnSTypeData || []) for (const row of grp.TnSTypeData || []) featRows.push({ group: grp.TnSType, label: RR.clean(row.TnSDataTitle), vals: (row.TnSDataArr || []).map((d) => RR.clean(d.TnSIsTrue === 'Y' ? 'Yes' : d.TnSIsTrue === '-' ? 'No' : [d.TnSIsTrue, d.TnSItemVal].filter(Boolean).join(' '))) });
        const specs = {};
        for (const grp of sdata?.TnSTypeData || []) for (const row of grp.TnSTypeData || []) { const v = (row.TnSDataArr || []).map((d) => d.TnSItemVal || d.TnSIsTrue).filter(Boolean)[0]; if (v) specs[RR.clean(row.TnSDataTitle)] = RR.clean(v); }
        const fuels = /e:?hev|hybrid/i.test(car.carModelFuelType) ? [car.carModelFuelType] : ['Petrol', 'e:HEV'];
        const combos = [];
        for (const t of trims) for (const f of fuels) for (const tr of ['MT (Manual)', 'CVT (Automatic)']) combos.push([t, f, tr]);
        const found = (await RR.pool(combos, 4, async ([t, f, tr]) => ({ t, f, tr, p: await price(car.carModelId, 'Delhi', f, tr, t) }))).filter((x) => x && x.p);
        const model = { model: car.carModelName.replace(/^(all\s+)?new\s+/i, ''), url: 'https://www.hondacarindia.com/' + car.carModelSiteUrl, image: (car.webUrlLink || [])[0], variants: [] };
        for (const v of found) {
          const prices = { DL: v.p };
          await RR.pool(Object.entries(cityByState).filter(([c]) => c !== 'DL'), 4, async ([code, city]) => { const p = await price(car.carModelId, city, v.f, v.tr, v.t); if (p) prices[code] = p; });
          const ti = trims.indexOf(v.t);
          model.variants.push({
            name: `${v.t} ${v.tr.split(' ')[0]} ${v.f}`, trim: v.t, fuel: /hev/i.test(v.f) ? 'Hybrid' : v.f, transmission: v.tr, engine: '',
            price: v.p, priceCity: 'Delhi', prices, specs, features: featRows.map((r) => ({ group: r.group, label: r.label, value: r.vals[ti] ?? '' })),
          });
        }
        out.push(model);
      } catch (e) { RR.warn('honda ' + car.carModelSiteUrl + ': ' + e); }
    }
    return { models: out, log: RR.log };
  },
};
