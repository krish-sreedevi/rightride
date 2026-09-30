// In-page helpers. This file is evaluated inside the brand's web page (via Playwright)
// before an adapter runs, so adapters can use window.RR.*
window.RR = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),

  async fetchText(url, opts = {}, tries = 3) {
    let last;
    for (let i = 0; i < tries; i++) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), opts.timeout || 45000);
        const r = await fetch(url, { ...opts, signal: ctrl.signal });
        clearTimeout(t);
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
        return await r.text();
      } catch (e) {
        last = e;
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    }
    throw last;
  },

  async fetchJSON(url, opts = {}) {
    return JSON.parse(await RR.fetchText(url, opts));
  },

  async fetchDoc(url, opts = {}) {
    const html = await RR.fetchText(url, opts);
    return new DOMParser().parseFromString(html, 'text/html');
  },

  // run async fn over items with limited concurrency
  async pool(items, n, fn) {
    const out = new Array(items.length);
    let i = 0;
    const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { __error: String(e) }; }
      }
    });
    await Promise.all(workers);
    return out;
  },

  num(s) {
    if (s == null) return null;
    const n = Number(String(s).replace(/[^\d.]/g, ''));
    return isFinite(n) && n > 0 ? n : null;
  },

  clean: (s) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim()),

  // table -> array of rows (array of cell texts)
  tableRows(t) {
    return [...t.rows].map((r) => [...r.cells].map((c) => RR.clean(c.textContent)));
  },

  log: [],
  warn(msg) { RR.log.push(String(msg)); },

  // One representative city per state/UT (used to query state-wise ex-showroom prices)
  STATE_CITIES: {
    AP: ['Andhra Pradesh', 'Vijayawada'], AR: ['Arunachal Pradesh', 'Itanagar'], AS: ['Assam', 'Guwahati'],
    BR: ['Bihar', 'Patna'], CG: ['Chhattisgarh', 'Raipur'], GA: ['Goa', 'Panaji'], GJ: ['Gujarat', 'Ahmedabad'],
    HR: ['Haryana', 'Gurgaon'], HP: ['Himachal Pradesh', 'Shimla'], JH: ['Jharkhand', 'Ranchi'],
    KA: ['Karnataka', 'Bangalore'], KL: ['Kerala', 'Kochi'], MP: ['Madhya Pradesh', 'Indore'],
    MH: ['Maharashtra', 'Mumbai'], MN: ['Manipur', 'Imphal'], ML: ['Meghalaya', 'Shillong'], MZ: ['Mizoram', 'Aizawl'],
    NL: ['Nagaland', 'Dimapur'], OD: ['Odisha', 'Bhubaneswar'], PB: ['Punjab', 'Ludhiana'], RJ: ['Rajasthan', 'Jaipur'],
    SK: ['Sikkim', 'Gangtok'], TN: ['Tamil Nadu', 'Chennai'], TS: ['Telangana', 'Hyderabad'], TR: ['Tripura', 'Agartala'],
    UP: ['Uttar Pradesh', 'Lucknow'], UK: ['Uttarakhand', 'Dehradun'], WB: ['West Bengal', 'Kolkata'],
    AN: ['Andaman and Nicobar Islands', 'Port Blair'], CH: ['Chandigarh', 'Chandigarh'],
    DN: ['Dadra and Nagar Haveli and Daman and Diu', 'Daman'], DL: ['Delhi', 'Delhi'], JK: ['Jammu and Kashmir', 'Jammu'],
    LA: ['Ladakh', 'Leh'], LD: ['Lakshadweep', 'Kavaratti'], PY: ['Puducherry', 'Puducherry'],
  },

  // match a free-text state name to our code
  stateCode(name) {
    const n = String(name || '').toLowerCase().replace(/[^a-z]/g, '');
    const alias = {
      newdelhi: 'DL', delhi: 'DL', nctofdelhi: 'DL', orissa: 'OD', odisha: 'OD', pondicherry: 'PY', puducherry: 'PY',
      uttaranchal: 'UK', uttarakhand: 'UK', chattisgarh: 'CG', chhattisgarh: 'CG', jammukashmir: 'JK', jammuandkashmir: 'JK',
      andamannicobarislands: 'AN', andamanandnicobarislands: 'AN', andamanandnicois: 'AN', andamannicobar: 'AN',
      dadranagarhaveli: 'DN', dadraandnagarhaveli: 'DN', damananddiu: 'DN', damandiu: 'DN', telengana: 'TS', telangana: 'TS',
    };
    if (alias[n]) return alias[n];
    for (const [c, [full]] of Object.entries(RR.STATE_CITIES)) {
      const f = full.toLowerCase().replace(/[^a-z]/g, '');
      if (f === n || f.startsWith(n) || n.startsWith(f)) return c;
    }
    if (n.startsWith('dadra') || n.startsWith('daman')) return 'DN';
    return null;
  },
};
