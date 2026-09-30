export default {
  brand: 'BMW',
  origin: 'https://www.bmw.in/en/all-models.html',
  async run(opts = {}) {
    const doc = await RR.fetchDoc('/en/all-models.html');
    const byModel = {};
    for (const card of doc.querySelectorAll('.cmp-allmodelscarddetail')) {
      let t = {};
      try { t = JSON.parse(card.getAttribute('data-tracking-attributes') || '{}'); } catch (e) {}
      const series = RR.clean(card.getAttribute('title') || card.querySelector('.cmp-allmodelscarddetail__series')?.textContent);
      if (!series || /concept|protection|vision/i.test(series)) continue;
      const priceTxt = (card.textContent.match(/₹\s?[\d,]+/) || [])[0];
      const price = RR.num(priceTxt);
      if (!price) continue;
      if (opts.only && !new RegExp(opts.only, 'i').test(series)) continue;
      const body = RR.clean(card.querySelector('.cmp-allmodelscarddetail__body-type')?.textContent);
      const fuel = { e: 'Electric', p: 'Petrol', o: 'Petrol', d: 'Diesel', h: 'PHEV', x: 'PHEV' }[t.fuelType] || (/hybrid/i.test(card.textContent) ? 'PHEV' : /electric/i.test(card.textContent) ? 'Electric' : /diesel/i.test(card.textContent) ? 'Diesel' : 'Petrol');
      const link = card.closest('.cmp-allmodelscard__root')?.parentElement?.querySelector('a[href]')?.getAttribute('href') || card.querySelector('a[href]')?.getAttribute('href');
      const img = card.querySelector('img')?.getAttribute('src') || card.closest('.cmp-allmodelscard__root')?.querySelector('img')?.getAttribute('src');
      const name = RR.clean(t.name) || series;
      const m = (byModel[series] = byModel[series] || { model: series.replace(/^(\d) series$/i, '$1 Series'), body: /sav|suv/i.test(body) ? 'SUV' : /coup|cabrio|roadster/i.test(body) ? 'Coupe / Convertible' : /sedan|gran/i.test(body) ? 'Sedan' : body, url: link ? new URL(link, location.origin).href : location.href, image: img ? new URL(img, location.origin).href : null, variants: [] });
      if (m.variants.some((v) => v.name === name && v.price === price)) continue;
      m.variants.push({ name, trim: name, fuel, transmission: 'Automatic', drive: /xdrive/i.test(name) ? 'AWD' : '', engine: '', price, priceCity: 'Delhi', prices: {}, features: [] });
    }
    return { models: Object.values(byModel), log: RR.log };
  },
};
