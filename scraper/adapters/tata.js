export default {
  brand: 'Tata',
  origin: 'https://tata.cars/',
  headful: true,
  settle: 8000,
  // also used by tata-ev.js with a different origin/segment
  async run(opts = {}) {
    const seg = location.host.startsWith('ev.') ? 'ev' : 'ice';
    const home = await RR.fetchDoc(location.origin + '/');
    const re = new RegExp('^https?://' + location.host.replace('.', '\\.') + '/([a-z0-9-]+)/' + seg + '\\.html$');
    const slugs = [...new Set([...home.querySelectorAll('a[href]')].map((a) => { try { return new URL(a.getAttribute('href'), location.origin).href; } catch (e) { return ''; } }).map((h) => (h.match(re) || [])[1]).filter(Boolean))];
    const out = [];
    for (const slug of slugs) {
      if (opts.only && !new RegExp(opts.only, 'i').test(slug)) continue;
      const url = `${location.origin}/${slug}/${seg}/specifications.html`;
      try {
        const doc = await RR.fetchDoc(url);
        const el = doc.querySelector('[data-productspecjson]');
        if (!el) { RR.warn('tata no spec json ' + url); continue; }
        const list = JSON.parse(el.getAttribute('data-productspecjson')).results.variantSpecFeature || [];
        const img = doc.querySelector('meta[property="og:image"]')?.content;
        const name = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) + (seg === 'ev' ? ' EV' : '');
        const model = { model: name, url: `${location.origin}/${slug}/${seg}.html`, image: img, variants: [] };
        for (const v of list) {
          const specs = {};
          for (const g of v.productSpecifications || []) for (const s of g.specList || []) if (s.specValue) specs[RR.clean(s.specLabel)] = RR.clean(s.specValue.replace(/<[^>]+>/g, ''));
          const features = [];
          for (const g of v.productFeatures || []) for (const f of g.featureList || []) features.push({ group: g.featureTypeTitle, label: RR.clean(f.featureLabel), value: f.featureValue == null ? 'No' : RR.clean(f.featureValue) });
          const [trimPart, fuelPart] = String(v.variantLabel).split(/,\s*(?=[^,]*$)/);
          model.variants.push({
            name: RR.clean(v.variantLabel), trim: RR.clean(trimPart), fuel: seg === 'ev' ? 'Electric' : RR.clean(fuelPart),
            transmission: specs['Transmission Type Label'] || specs['Transmission Type'] || '', engine: specs['Engine Type'] || '',
            price: RR.num(v.startingPrice), priceCity: 'Mumbai', prices: {}, specs, features,
          });
        }
        out.push(model);
      } catch (e) { RR.warn('tata ' + slug + ': ' + e); }
    }
    return { models: out, log: RR.log };
  },
};
