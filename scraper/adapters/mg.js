export default {
  brand: 'MG',
  origin: 'https://www.mgmotor.co.in/vehicles/mgastor/specifications',
  async run(opts = {}) {
    const val = (id, dflt) => document.getElementById(id)?.value || dflt;
    const vEp = val('variantsEndpoint', 'https://eeysubngbk.execute-api.ap-south-1.amazonaws.com/prod/api/variants');
    const vKey = val('variantskey', 'xuQ7dH6jOq7L0ZmHVWkEw5HPYwXWYB2L8ASWJPn1');
    const cEp = val('variantModelApiEndPoint', 'https://jpkzrf9kjg.execute-api.ap-south-1.amazonaws.com/prod/carcomparison/internal');
    const cKey = val('variantModelApiKey', 'MtZz8KL50230EbLicq0fq8i5zJMrcihp5uthionf');
    const lines = await RR.fetchJSON(vEp, { headers: { 'x-api-key': vKey } });
    const FUEL = { '01': 'Diesel', '02': 'Petrol', '03': 'CNG', '04': 'Hybrid', '05': 'Electric', '06': 'PHEV' };
    const out = [];
    for (const line of lines) {
      const mname = line.model_line.replace(/^MG_/, '').replace(/_/g, ' ').replace(/\b(\w)(\w*)/g, (m, a, b) => a + b.toLowerCase()).replace(/\bEv\b/g, 'EV').replace(/\bZs\b/, 'ZS');
      if (opts.only && !new RegExp(opts.only, 'i').test(mname)) continue;
      const model = { model: mname, url: 'https://www.mgmotor.co.in/', variants: [] };
      const seen = new Set();
      await RR.pool(line.variants || [], 3, async (v) => {
        if (seen.has(v.model_sales_code)) return; seen.add(v.model_sales_code);
        const j = await RR.fetchJSON(cEp + '?variantID=' + encodeURIComponent(v.model_sales_code), { headers: { 'x-api-key': cKey } });
        const d = j && j[0];
        const features = [], specs = {};
        for (const vv of d?.variants || []) for (const c of vv.Categories || []) for (const a of c.CategoriesValues || []) {
          if (!a.AttributeName) continue;
          if (/engine|dimension|capacit|battery|performance|tyre|brake|suspension|technical|specification/i.test(c.CategoryName) && !/safety/i.test(c.CategoryName)) specs[RR.clean(a.AttributeName)] = RR.clean(a.AttributeValue);
          else features.push({ group: c.CategoryName, label: RR.clean(a.AttributeName), value: RR.clean(a.AttributeValue) });
        }
        const name = RR.clean(v.model_text1 || d?.MODEL_TEXT1);
        model.variants.push({
          name, trim: RR.clean(v.modelseries), fuel: FUEL[v.fuel_type] || v.fuel_type, transmission: v.vehicle_type === 'AUTM' ? 'Automatic' : /^MAN/.test(v.vehicle_type) ? 'Manual' : v.vehicle_type,
          seats: v.passenger_capacity || null, engine: '', price: RR.num(d?.Price), priceCity: 'Delhi', prices: {}, specs, features, year: v.year,
        });
      });
      model.variants = model.variants.filter((v) => v.price);
      if (model.variants.length) out.push(model); else RR.warn('mg no priced variants ' + mname);
    }
    return { models: out, log: RR.log };
  },
};
