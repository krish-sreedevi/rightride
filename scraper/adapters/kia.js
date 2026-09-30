export default {
  brand: 'Kia',
  origin: 'https://www.kia.com/in/our-vehicles/seltos/showroom.html',
  async run(opts = {}) {
    // model slugs from site navigation
    const home = await RR.fetchDoc('/in/home.html');
    const slugs = [...new Set([...home.querySelectorAll('a[href*="/in/our-vehicles/"]')].map((a) => (a.getAttribute('href').match(/\/in\/our-vehicles\/([a-z0-9-]+)\/(showroom|specs)/) || [])[1]).filter(Boolean))];
    const out = [];
    for (const slug of slugs) {
      if (opts.only && !new RegExp(opts.only, 'i').test(slug)) continue;
      try {
        const doc = await RR.fetchDoc(`/in/our-vehicles/${slug}/specs.html`);
        const tabs = [...doc.querySelectorAll('a.tab[data-trim-name]')];
        if (!tabs.length) { RR.warn('kia no trims ' + slug); continue; }
        const title = RR.clean(doc.querySelector('meta[property="og:title"]')?.content || slug).replace(/\s*\|.*$/, '');
        const specs = {};
        for (const li of doc.querySelectorAll('ul.specs-list li')) {
          const t = [...li.children].map((c) => RR.clean(c.textContent)).filter(Boolean);
          if (t.length >= 2) specs[t[0]] = t[1];
        }
        const model = { model: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/Ev(\d)/, 'EV$1'), title, url: `https://www.kia.com/in/our-vehicles/${slug}/showroom.html`, image: doc.querySelector('meta[property="og:image"]')?.content, variants: [] };
        const seen = new Set();
        for (const t of tabs) {
          const trim = RR.clean(t.dataset.trimName);
          if (seen.has(trim)) continue; seen.add(trim);
          const key = trim.replace(/\s+/g, '');
          const ul = [...doc.querySelectorAll('ul.specs-highlights-list')].find((u) => (u.dataset.spec || '').replace(/\s+/g, '') === key);
          const features = ul ? [...ul.querySelectorAll('li')].map((li) => ({ group: 'Highlights', label: RR.clean(li.textContent), value: 'Yes' })) : [];
          model.variants.push({ name: trim, trim, fuel: '', transmission: /\(A\)|AT|DCT|IVT/.test(trim) ? 'Automatic' : '', engine: '', price: RR.num(t.dataset.price), priceCity: 'Delhi', prices: {}, specs, features, cumulativeFeatures: true });
        }
        out.push(model);
      } catch (e) { RR.warn('kia ' + slug + ': ' + e); }
    }
    return { models: out, log: RR.log };
  },
};
