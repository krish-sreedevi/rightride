/* RightRide — client app (no build step) */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get(k, d) { try { const v = localStorage.getItem('rr.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('rr.' + k, JSON.stringify(v)); } catch (e) {} } };

  const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
  const lakh = (n) => (n >= 1e7 ? '₹' + (n / 1e7).toFixed(2) + ' Cr' : '₹' + (n / 1e5).toFixed(2) + ' L');

  let DATA, RTO, FKEYS = [], FIDX = {};
  const state = {
    st: store.get('state', 'DL'),
    budgetMin: '', budgetMax: '',
    body: new Set(), seats: new Set(), brand: new Set(), fuel: new Set(), trans: new Set(), transType: new Set(), drive: new Set(),
    feats: new Set(), allowUnknown: true, closeMatches: true, sort: 'price', page: 1,
    compare: new Set(), open: new Set(), rec: null, tab: 'foryou', q: '', qf: null,
  };
  const PAGE = 20;

  // ---------------- on-road price engine ----------------
  const fuelKey = (f) => ({ Petrol: 'petrol', Diesel: 'diesel', CNG: 'cng', Hybrid: 'hybrid', PHEV: 'hybrid', Electric: 'electric' }[f] || 'petrol');
  const slab = (slabs, x) => { for (const [upto, v] of slabs) if (upto == null || x <= upto) return v; return slabs[slabs.length - 1][1]; };
  const rateFor = (v, fk) => (typeof v === 'number' ? v : v[fk] ?? (fk === 'cng' || fk === 'hybrid' ? v.petrol : undefined) ?? v.petrol ?? 0);

  function onRoad(car, st) {
    const r = RTO.states[st] || RTO.states.DL;
    const c = RTO.common;
    const ex = (car.prices && car.prices[st]) || car.price;
    const fk = fuelKey(car.fuel);
    const items = [['Ex-showroom price' + (car.prices && car.prices[st] ? '' : ` (${car.priceCity || 'Delhi'})`), ex]];
    let rate = null, tax = 0, taxNote = '';
    if (fk === 'electric') {
      if (r.evSlabs) rate = slab(r.evSlabs, ex);
      else if (r.evAbove && ex > r.evAbove[0]) rate = r.evAbove[1];
      else rate = r.ev ?? 0;
    } else if (r.flat) { tax = slab(r.flat, ex); taxNote = 'flat'; }
    else if (r.ccSlabs) rate = rateFor(slab(r.ccSlabs, car.cc || 1200), fk);
    else rate = rateFor(slab(r.slabs, ex), fk);
    if (fk === 'hybrid' && r.hybridExempt) rate = 0;
    if (fk === 'hybrid' && r.hybrid != null) rate = r.hybrid;
    if (rate != null) tax = (ex * rate) / 100;
    if (r.min && tax < r.min && fk !== 'electric') tax = r.min;
    items.push([`Road tax${rate != null ? ` (${rate}%)` : taxNote ? ' (flat)' : ''}`, tax]);
    if (r.cessOfTax && tax) items.push([`Cess / surcharge (${r.cessOfTax}% of tax)`, (tax * r.cessOfTax) / 100]);
    for (const [label, amt] of r.fixed || []) items.push([label, amt]);
    if (r.greenTax && fk !== 'electric') items.push(['Green tax', slab(r.greenTax, ex)]);
    if (r.greenByFuel && r.greenByFuel[fk]) items.push(['Green tax', r.greenByFuel[fk]]);
    if (r.infraCess) { const ic = slab(r.infraCess, ex); if (ic) items.push(['Infrastructure cess', ic]); }
    items.push(['Registration, number plate (HSRP) & smart card', c.registration + c.hsrpSmartCard]);
    // insurance estimate: 1-yr own damage + 3-yr third party, + GST
    const idv = ex * 0.95;
    const tp = fk === 'electric' ? slab(c.insurance.tp3yrEV, car.kw || 45) : slab(c.insurance.tp3yr, car.cc || 1200);
    const ins = (idv * c.insurance.odRate / 100 + tp) * (1 + c.insurance.gst / 100);
    items.push(['Insurance (est.: 1-yr own damage + 3-yr third party)', ins]);
    items.push(['FASTag', c.fastag]);
    if (ex > c.tcsAbove) items.push(['TCS (1%, claimable in your income-tax return)', (ex * c.tcsRate) / 100]);
    const total = items.reduce((s, [, v]) => s + v, 0);
    return { ex, items, total, approx: !!r.approx, note: r.note };
  }

  // ---------------- data prep ----------------
  const FUELS = ['Petrol', 'Diesel', 'CNG', 'Hybrid', 'Electric'];
  // filters we deliberately don't offer (data is still shown on each car's detail page)
  const HIDE_BUCKETS = new Set(['Safety', 'Exterior & Lighting']);
  const HIDE_FEATS = new Set(['digitalCluster', 'premiumAudio', 'voiceCommands', 'dualZone', 'rearAC', 'cruise', 'autoIRVM', 'paddleShifters', 'driveModes', 'rearArmrest', 'tiltTelescopic', 'powerTailgate', 'panoramic', 'dashcam', 'leather', 'airPurifier', 'massage', 'captainSeats']);
  const filterable = (f) => !HIDE_BUCKETS.has(f.bucket) && !HIDE_FEATS.has(f.key);
  const BODY_MAP = { 'Coupe / Convertible': 'Sedan', Pickup: 'SUV' };
  const seatGroup = (n) => (!n ? null : n <= 5 ? '4–5' : '6–7');
  const TTYPES = { MT: 'Manual', AMT: 'AMT', AT: 'Torque converter (AT)', CVT: 'CVT / IVT', 'e-CVT': 'e-CVT (hybrid)', DCT: 'Dual-clutch (DCT/DSG)' };
  function prep() {
    FKEYS = DATA.features.map((f) => f.key);
    DATA.features.forEach((f, i) => (FIDX[f.key] = i));
    for (const c of DATA.cars) {
      c.feat = (k) => c.fs[FIDX[k]];
      if (BODY_MAP[c.body]) c.body = BODY_MAP[c.body];
      if (c.fuel === 'PHEV') c.fuel = 'Hybrid';
    }
    for (const k of [...state.feats]) if (FIDX[k] == null || !filterable(DATA.features[FIDX[k]])) state.feats.delete(k);
    for (const v of [...state.seats]) if (!['4–5', '6–7'].includes(v)) state.seats.delete(v);
    for (const v of [...state.body]) if (BODY_MAP[v]) { state.body.delete(v); state.body.add(BODY_MAP[v]); }
    if (state.fuel.delete('PHEV')) state.fuel.add('Hybrid');
    state.transType.clear(); state.drive.clear();
    recalc();
  }
  function recalc() {
    for (const c of DATA.cars) { c.or = onRoad(c, state.st); c.orTotal = c.or.total; }
  }

  // ---------------- filtering ----------------
  function evaluate(c) {
    const lo = state.budgetMin ? Number(state.budgetMin) * 1e5 : 0;
    const hi = state.budgetMax ? Number(state.budgetMax) * 1e5 : Infinity;
    if (c.orTotal < lo || c.orTotal > hi) return null;
    if (!queryMatch(c)) return null;
    if (state.body.size && !state.body.has(c.body)) return null;
    if (state.brand.size && !state.brand.has(c.brand)) return null;
    if (state.fuel.size && !state.fuel.has(c.fuel)) return null;
    if (state.trans.size && !state.trans.has(c.transmission)) return null;
    if (state.transType.size && !state.transType.has(c.transType)) return null;
    if (state.drive.size && !state.drive.has(c.drive)) return null;
    if (state.seats.size && !state.seats.has(seatGroup(c.seats))) return null;
    let miss = [], unk = [];
    const fo = featsOn();
    for (const k of fo) { const v = c.feat(k); if (v === '0') miss.push(k); else if (v === '?') unk.push(k); }
    if (miss.length > (state.closeMatches ? 1 : 0)) return null;
    if (state.qf && state.qf.feats.some((k) => miss.includes(k))) return null; // features typed in the search are must-haves
    if (unk.length && !state.allowUnknown) return null;
    return { miss, unk, score: fo.size - miss.length - unk.length * 0.5 };
  }

  function results() {
    const models = new Map();
    for (const c of DATA.cars) {
      const ev = evaluate(c);
      if (!ev) continue;
      const key = c.brand + '|' + c.model;
      if (!models.has(key)) models.set(key, { brand: c.brand, model: c.model, body: c.body, url: c.url, image: c.image, image2: c.image2, vs: [] });
      models.get(key).vs.push({ c, ev });
    }
    const list = [...models.values()];
    for (const m of list) {
      m.vs.sort((a, b) => (a.ev.miss.length - b.ev.miss.length) || (a.ev.unk.length - b.ev.unk.length) || a.c.orTotal - b.c.orTotal);
      const tier = (x) => (x.ev.miss.length ? 2 : x.ev.unk.length ? 1 : 0);
      m.tier = Math.min(...m.vs.map(tier));
      const top = m.vs.filter((x) => tier(x) === m.tier);
      m.best = top.slice().sort((a, b) => a.c.orTotal - b.c.orTotal)[0];
      m.exact = m.vs.filter((x) => !x.ev.miss.length).length;
      m.confirmed = m.tier === 0;
      m.min = Math.min(...m.vs.map((x) => x.c.orTotal)); m.max = Math.max(...m.vs.map((x) => x.c.orTotal));
      m.score = Math.max(...m.vs.map((x) => x.ev.score));
      m.fuels = [...new Set(m.vs.map((x) => x.c.fuel))];
      m.trans = [...new Set(m.vs.map((x) => x.c.transmission).filter(Boolean))];
      m.maxFeat = Math.max(...m.vs.map((x) => x.c.fs.split('1').length - 1));
      m.mileage = Math.max(0, ...m.vs.map((x) => x.c.mileage || 0));
    }
    const s = (state.qf && state.qf.sort && state.sort !== 'rec') ? state.qf.sort : state.sort;
    if (s === 'rec' && state.rec) scoreRecs(list);
    list.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier; // confirmed matches, then unconfirmed, then near-misses
      if (s === 'rec' && state.rec) return b.match - a.match;
      if (s === 'priceDesc') return b.best.c.orTotal - a.best.c.orTotal;
      if (s === 'match') return b.score - a.score || a.best.c.orTotal - b.best.c.orTotal;
      if (s === 'features') return b.maxFeat - a.maxFeat;
      if (s === 'mileage') return b.mileage - a.mileage;
      if (s === 'expert') { const xa = (expertOf(a) || {}).s || 0, xb = (expertOf(b) || {}).s || 0; return xb - xa || a.best.c.orTotal - b.best.c.orTotal; }
      return a.best.c.orTotal - b.best.c.orTotal;
    });
    return list;
  }

  // ---------------- UI: filters ----------------
  const countBy = (fn) => { const m = {}; for (const c of DATA.cars) { const k = fn(c); if (k != null) m[k] = (m[k] || 0) + 1; } return m; };
  function chips(name, values, set, labels = {}) {
    return `<div class="chips" data-set="${name}">${values.map((v) => `<button type="button" class="chip" data-v="${esc(v)}" aria-pressed="${set.has(v)}">${esc(labels[v] || v)}</button>`).join('')}</div>`;
  }
  function buildFilters() {
    const bodies = Object.keys(countBy((c) => c.body)).sort();
    const brands = Object.keys(countBy((c) => c.brand)).sort();
    const fuels = FUELS.filter((f) => DATA.cars.some((c) => c.fuel === f));
    const byBucket = {};
    for (const f of DATA.features) (byBucket[f.bucket] = byBucket[f.bucket] || []).push(f);
    const featCount = (k) => DATA.cars.filter((c) => c.feat(k) === '1').length;
    let html = `
      <details class="bucket" open><summary>Budget &amp; basics</summary>
        <div class="group"><div class="label">On-road budget</div>
          <div class="range"><label class="money"><span>₹</span><input id="bmin" inputmode="decimal" placeholder="Min" value="${esc(state.budgetMin)}" aria-label="Minimum budget in lakh"><em>L</em></label><span class="muted">–</span><label class="money"><span>₹</span><input id="bmax" inputmode="decimal" placeholder="Max" value="${esc(state.budgetMax)}" aria-label="Maximum budget in lakh"><em>L</em></label></div>
        </div>
        <div class="group"><div class="label">Body type</div>${chips('body', ['Hatchback', 'Sedan', 'SUV', 'MUV / MPV'].filter((x) => bodies.includes(x)), state.body)}</div>
        <div class="group"><div class="label">Seats</div>${chips('seats', ['4–5', '6–7'], state.seats)}</div>
        <div class="group"><div class="label">Brand</div>${chips('brand', brands, state.brand)}</div>
      </details>
      <details class="bucket" open><summary>Fuel &amp; gearbox</summary>
        <div class="group"><div class="label">Fuel type</div>${chips('fuel', fuels, state.fuel)}</div>
        <div class="group"><div class="label">Transmission</div>${chips('trans', ['Manual', 'Automatic'], state.trans)}</div>
      </details>`;
    for (const b of DATA.buckets) {
      const fs = (byBucket[b] || []).filter((f) => filterable(f) && featCount(f.key) > 0);
      if (!fs.length) continue;
      const on = fs.filter((f) => state.feats.has(f.key)).length;
      html += `<details class="bucket"${on ? ' open' : ''}><summary>${esc(b)}<span class="count">${on ? on + ' selected' : ''}</span></summary>
        <div class="group"><div class="chips" data-set="feats">${fs.map((f) => `<button type="button" class="chip" data-v="${f.key}" aria-pressed="${state.feats.has(f.key)}">${esc(f.label)}</button>`).join('')}</div></div></details>`;
    }
    html += `<details class="bucket" open><summary>Matching</summary>
      <label class="toggle"><input type="checkbox" id="closeMatches" ${state.closeMatches ? 'checked' : ''}> Also show cars missing 1 feature</label>
      <label class="toggle"><input type="checkbox" id="allowUnknown" ${state.allowUnknown ? 'checked' : ''}> Include cars whose feature list isn't published</label>
      <p class="hint">Some makers don't publish variant-wise feature lists online; those cars show "not confirmed".</p></details>`;
    $('#filterBody').innerHTML = html;
  }

  function onFilterClick(e) {
    const b = e.target.closest('button.chip');
    if (!b) return;
    if (b.dataset.budget) {
      const [a, z] = b.dataset.budget.split(',');
      state.budgetMin = a === '0' ? '' : a; state.budgetMax = z; $('#bmin').value = state.budgetMin; $('#bmax').value = state.budgetMax;
    } else {
      const set = state[b.closest('[data-set]').dataset.set];
      const v = b.dataset.v;
      set.has(v) ? set.delete(v) : set.add(v);
      b.setAttribute('aria-pressed', set.has(v));
      const d = b.closest('details'); const cnt = d && d.querySelector('.count');
      if (cnt) { const n = $$('.chip[aria-pressed="true"]', d).length; cnt.textContent = n ? n + ' selected' : ''; }
    }
    state.page = 1; saveFilters(); render();
  }


  // ---------------- car images ----------------
  // every model has a picture: Autocar India studio shot (resized by its CDN) → maker's image → drawn silhouette
  const SIL = { Hatchback: 'M14 46h92M20 46c0-14 6-20 18-22l14-10h26l16 12c6 2 10 8 10 20M40 24h46', Sedan: 'M8 46h104M14 46c0-10 4-14 14-16l18-12h30l18 12c10 1 16 6 16 16M44 30h50', SUV: 'M10 46h100M14 46V30l10-14h56l12 14c8 1 12 6 12 16M28 16v14h64', 'MUV / MPV': 'M10 46h100M14 46V28l12-12h60l12 12c6 2 10 8 10 18M30 16v12h60' };
  function silhouette(body) {
    const d = SIL[body] || SIL.SUV;
    return `<svg class="sil" viewBox="0 0 120 60" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="34" cy="46" r="7" fill="var(--panel)" stroke="currentColor" stroke-width="2.2"/><circle cx="88" cy="46" r="7" fill="var(--panel)" stroke="currentColor" stroke-width="2.2"/></svg>`;
  }
  const sized = (u, w) => (/asset\.autocarindia\.com/.test(u) ? `${u}?w=${w}` : u);
  function carImg(m, sizes = '(max-width: 900px) 120px, 200px') {
    if (!m.image) return silhouette(m.body);
    const alt = `${m.brand} ${m.model}`;
    const set = /asset\.autocarindia\.com/.test(m.image) ? ` srcset="${esc(sized(m.image, 320))} 320w, ${esc(sized(m.image, 480))} 480w, ${esc(sized(m.image, 720))} 720w" sizes="${sizes}"` : '';
    return `<img loading="lazy" decoding="async" src="${esc(sized(m.image, 480))}"${set} alt="${esc(alt)}" data-alt2="${esc(m.image2 || '')}" data-body="${esc(m.body)}" onerror="window.__rrImgErr&&window.__rrImgErr(this)">`;
  }
  window.__rrImgErr = (img) => {
    const alt = img.dataset.alt2;
    if (alt) { img.dataset.alt2 = ''; img.removeAttribute('srcset'); img.src = alt; return; }
    const t = document.createElement('template'); t.innerHTML = silhouette(img.dataset.body); img.replaceWith(t.content.firstChild);
  };

  // ---------------- showroom: tabs, shelves, tiles, model sheet, search ----------------
  const TABS = [
    { id: 'picks', label: 'Your picks', when: () => !!state.rec },
    { id: 'foryou', label: 'For you' },
    { id: 'suv', label: 'SUVs', set: { body: ['SUV'] } },
    { id: 'hatch', label: 'Hatchbacks', set: { body: ['Hatchback'] } },
    { id: 'sedan', label: 'Sedans', set: { body: ['Sedan'] } },
    { id: 'muv', label: 'MUVs', set: { body: ['MUV / MPV'] } },
    { id: 'ev', label: 'Electric', set: { fuel: ['Electric'] } },
    { id: 'u10', label: 'Under ₹10 L', max: 10 },
    { id: 'top', label: 'Top rated', sort: 'expert' },
    { id: 'all', label: 'All cars' },
  ];
  function drawTabs() {
    const n = activeCount();
    $('#tabs').innerHTML = `<div class="tab-row">${TABS.filter((t) => !t.when || t.when()).map((t) => `<button type="button" class="tab${state.tab === t.id ? ' on' : ''}" data-tab="${t.id}">${esc(t.label)}</button>`).join('')}</div>
      <button type="button" id="openFilters" class="filter-btn${n ? ' has' : ''}"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Filters <span id="filterCount">${n ? n : ''}</span></button>`;
  }
  const activeCount = () => state.feats.size + ['body', 'fuel', 'trans', 'seats', 'brand'].reduce((s, k) => s + state[k].size, 0) + (state.budgetMin || state.budgetMax ? 1 : 0);
  function clearFilters() { for (const k of SETS) state[k].clear(); state.budgetMin = state.budgetMax = ''; state.q = ''; state.qf = null; const q = $('#q'); if (q) q.value = ''; }
  function setTab(id, opts = {}) {
    const t = TABS.find((x) => x.id === id) || TABS[1];
    if (id === 'picks' && state.rec) { state.tab = 'picks'; applyRec(state.rec, true); return; }
    state.tab = t.id;
    if (t.id !== 'foryou' && !opts.keep) {
      clearFilters();
      for (const [k, vals] of Object.entries(t.set || {})) vals.forEach((v) => state[k].add(v));
      if (t.max) state.budgetMax = String(t.max);
      state.sort = t.sort || (state.sort === 'rec' ? 'price' : state.sort === 'expert' && !t.sort ? 'price' : state.sort);
      $('#sort').value = state.sort;
    }
    state.page = 1; store.set('tab', state.tab);
    saveFilters(); buildFilters(); render();
    if (!opts.noScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // every model with all its variants (shelves ignore the filters)
  function groupAll() {
    const g = new Map();
    for (const c of DATA.cars) {
      const k = c.brand + '|' + c.model;
      if (!g.has(k)) g.set(k, { brand: c.brand, model: c.model, body: c.body, url: c.url, image: c.image, image2: c.image2, vs: [] });
      g.get(k).vs.push({ c, ev: { miss: [], unk: [], score: 0 } });
    }
    for (const m of g.values()) {
      m.min = Math.min(...m.vs.map((x) => x.c.orTotal)); m.max = Math.max(...m.vs.map((x) => x.c.orTotal));
      m.fuels = [...new Set(m.vs.map((x) => x.c.fuel))];
      m.trans = [...new Set(m.vs.map((x) => x.c.transmission).filter(Boolean))];
      m.mileage = Math.max(0, ...m.vs.map((x) => (x.c.fuel === 'Electric' ? 0 : x.c.mileage || 0)));
      m.seatsMax = Math.max(0, ...m.vs.map((x) => x.c.seats || 0));
      m.x = expertOf(m); m.s = (m.x && m.x.s) || 0;
    }
    return [...g.values()];
  }
  const L = 1e5;
  const byScore = (a, b) => b.s - a.s || a.min - b.min;
  const SHELVES = [
    { id: 'top', title: 'Top rated by experts', sub: 'Autocar India\'s highest-scoring cars on sale right now', pick: (ms) => ms.filter((m) => m.s).sort(byScore), feature: true, see: { tab: 'top' } },
    { id: 'value', title: 'Best value under ₹10 L', sub: 'Expert favourites that won\'t stretch the budget', pick: (ms) => ms.filter((m) => m.min <= 10 * L).sort(byScore), see: { tab: 'u10', sort: 'expert' } },
    { id: 'csuv', title: 'Compact SUVs under ₹15 L', sub: 'India\'s favourite kind of car', pick: (ms) => ms.filter((m) => m.body === 'SUV' && m.min <= 15 * L).sort(byScore), see: { set: { body: ['SUV'] }, max: 15, sort: 'expert' } },
    { id: 'family', title: 'Family 7-seaters', sub: 'Room for everyone — SUVs and MUVs with three rows', pick: (ms) => ms.filter((m) => m.seatsMax >= 6).sort(byScore), see: { set: { seats: ['6–7'] }, sort: 'expert' } },
    { id: 'auto12', title: 'Automatics under ₹12 L', sub: 'Two pedals, no clutch, sensible money', pick: (ms) => ms.filter((m) => m.vs.some((x) => x.c.transmission === 'Automatic' && x.c.orTotal <= 12 * L)).sort(byScore), see: { set: { trans: ['Automatic'] }, max: 12, sort: 'expert' } },
    { id: 'ev', title: 'Go electric', sub: 'Every EV on sale, priced for your state', pick: (ms) => ms.filter((m) => m.fuels.includes('Electric')).sort(byScore), see: { tab: 'ev' } },
    { id: 'mileage', title: 'Mileage champions', sub: 'The most kilometres per litre', pick: (ms) => ms.filter((m) => m.mileage).sort((a, b) => b.mileage - a.mileage), stat: (m) => `${m.mileage} km/l`, see: { sort: 'mileage' } },
    { id: 'hatch', title: 'City hatchbacks', sub: 'Easy to park, easy on the wallet', pick: (ms) => ms.filter((m) => m.body === 'Hatchback').sort(byScore), see: { tab: 'hatch' } },
    { id: 'sedan', title: 'Sedans', sub: 'Boot space and highway comfort', pick: (ms) => ms.filter((m) => m.body === 'Sedan').sort(byScore), see: { tab: 'sedan' } },
    { id: 'lux', title: 'Luxury', sub: 'From ₹50 lakh and up', pick: (ms) => ms.filter((m) => m.min >= 50 * L).sort(byScore), see: { min: 50, sort: 'expert' } },
  ];
  function seeAll(id) {
    const sh = SHELVES.find((x) => x.id === id); if (!sh) return;
    const see = sh.see || {};
    if (see.tab) { setTab(see.tab); if (see.sort) { state.sort = see.sort; $('#sort').value = see.sort; saveFilters(); render(); } return; }
    clearFilters();
    for (const [k, vals] of Object.entries(see.set || {})) vals.forEach((v) => state[k].add(v));
    if (see.max) state.budgetMax = String(see.max);
    if (see.min) state.budgetMin = String(see.min);
    state.sort = see.sort || 'price'; $('#sort').value = state.sort;
    state.tab = 'all'; state.page = 1; saveFilters(); buildFilters(); render(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function tile(m, opts = {}) {
    const x = expertOf(m);
    const key = m.brand + '|' + m.model;
    const sub = opts.stat ? opts.stat(m) : (x && x.like && x.like[0]) || `${m.fuels.join(' · ')}`;
    const nF = featsOn().size;
    const warn = nF && m.best ? (m.best.ev.miss.length ? `<span class="tw miss">Missing ${m.best.ev.miss.length}</span>` : m.best.ev.unk.length ? `<span class="tw unk">${m.best.ev.unk.length} unconfirmed</span>` : `<span class="tw ok">${nF === 1 ? esc(FLABEL([...featsOn()][0]).replace(/ \(.*\)$/, '')) : 'All ' + nF} ✓</span>`) : '';
    return `<article class="tile${opts.big ? ' big' : ''}" data-key="${esc(key)}" tabindex="0" role="button" aria-label="${esc(m.brand + ' ' + m.model)}">
      ${x && x.s ? `<span class="sc">${esc(x.s)}/10</span>` : ''}<span class="pr">${lakh(m.min)}</span>
      <div class="timg">${carImg(m, opts.big ? '(max-width: 900px) 86vw, 560px' : '(max-width: 900px) 70vw, 280px')}</div>
      <div class="tt"><h3>${opts.big ? esc(m.brand) + ' ' : ''}${esc(m.model)}</h3><div class="m">${opts.big ? esc(sub) : `${esc(m.brand)} · ${esc(sub)}`}</div>${warn}</div>
    </article>`;
  }
  function drawShelves() {
    const ms = groupAll();
    $('#shelves').innerHTML = SHELVES.map((sh) => {
      const items = sh.pick(ms).slice(0, 12);
      if (!items.length) return '';
      return `<section class="shelf" data-shelf="${sh.id}"><div class="shelf-head"><div><h2 class="display">${esc(sh.title)}</h2><p>${esc(sh.sub)}</p></div><button class="see" type="button" data-see="${sh.id}">See all <span aria-hidden="true">›</span></button></div>
        <div class="rail-wrap"><button class="rail-btn prev" type="button" aria-label="Scroll left">‹</button><div class="rail">${items.map((m, i) => tile(m, { big: sh.feature && i === 0, stat: sh.stat })).join('')}</div><button class="rail-btn next" type="button" aria-label="Scroll right">›</button></div></section>`;
    }).join('');
  }

  // natural-language search → filters ("SUV with sunroof", "automatic under 12 lakh with 360 camera", "safest 7 seater")
  const BRANDS = () => [...new Set(DATA.cars.map((c) => c.brand))];
  const FEAT_WORDS = [
    ['panoramic', 'panoramic|pano(?:ramic)?\\s*(?:sun|moon)?\\s*roof|big sun\\s*roof|dual.?pane sunroof'],
    ['sunroof', 'sun\\s*-?roofs?|moon\\s*-?roofs?'],
    ['camera360', '360(?:\\s*(?:°|deg(?:ree)?s?|-degree))?(?:\\s*(?:camera|cam|view))?|surround\\s*(?:view\\s*)?camera|bird.?s.?eye'],
    ['adas', 'adas|level\\s*-?\\s*2|auto(?:nomous)?\\s*(?:emergency\\s*)?brak\\w*|lane\\s*(?:keep\\w*|assist)|adaptive cruise'],
    ['ventilated', 'ventilated(?:\\s*seats?)?|cooled seats?|cooling seats?'],
    ['wirelessCharger', 'wireless\\s*(?:phone\\s*)?charg\\w*|wireless pad'],
    ['wirelessAA', 'wireless\\s*(?:android\\s*auto|apple\\s*car\\s*play|car\\s*play)'],
    ['androidAuto', 'android\\s*auto|apple\\s*car\\s*play|car\\s*play'],
    ['touchscreen', 'touch\\s*screens?|infotainment|big screen'],
    ['rearCamera', '(?:rear|reverse|reversing|back(?:up)?|parking)\\s*cam(?:era)?s?'],
    ['frontSensors', 'front\\s*(?:parking\\s*)?sensors?'],
    ['rearSensors', '(?:rear\\s*)?parking\\s*sensors?|reverse\\s*sensors?'],
    ['cruise', 'cruise(?:\\s*control)?'],
    ['airbags6', '(?:6|six)\\s*-?\\s*air\\s*bags?'],
    ['isofix', 'isofix|child\\s*seat\\s*mounts?'],
    ['hud', 'hud|head\\s*-?\\s*up(?:\\s*display)?'],
    ['dualZone', 'dual\\s*-?\\s*zone(?:\\s*(?:climate|ac|a/c))?'],
    ['autoClimate', 'auto(?:matic)?\\s*(?:climate(?:\\s*control)?|ac|a/c)|climate\\s*control'],
    ['rearAC', 'rear\\s*(?:ac|a/c)(?:\\s*vents?)?|rear\\s*vents?'],
    ['pushStart', 'push\\s*-?\\s*(?:button\\s*)?start|keyless\\s*(?:go|start)'],
    ['keyless', 'keyless(?:\\s*entry)?|smart\\s*key'],
    ['poweredSeat', '(?:powered|power|electric(?:ally)?(?:\\s*adjustable)?)\\s*(?:driver\\s*)?seats?'],
    ['connected', 'connected(?:\\s*car(?:\\s*tech)?)?|app\\s*control|remote\\s*start'],
    ['digitalCluster', 'digital\\s*(?:instrument\\s*)?(?:cluster|dials?|display|dash(?:board)?)'],
    ['premiumAudio', '(?:premium|branded|bose|jbl|harman(?:\\s*kardon)?|sony|infinity|arkamys|burmester|bang\\s*(?:&|and)\\s*olufsen)(?:\\s*(?:sound(?:\\s*system)?|audio|speakers?|music))?'],
    ['ambient', 'ambient(?:\\s*light\\w*)?|mood\\s*light\\w*'],
    ['leather', 'leather(?:ette)?(?:\\s*seats?|\\s*upholstery)?'],
    ['airPurifier', 'air\\s*purifier'],
    ['massage', 'massag\\w*(?:\\s*seats?)?'],
    ['captainSeats', 'captain(?:\\s*seats?|\\s*chairs?)?'],
    ['paddleShifters', 'paddle\\s*shift\\w*|paddles'],
    ['driveModes', 'drive\\s*modes?|terrain\\s*modes?'],
    ['epb', 'electronic\\s*parking\\s*brake|epb|auto\\s*hold'],
    ['powerTailgate', '(?:power(?:ed)?|electric|hands\\s*-?\\s*free)\\s*(?:tailgate|boot)'],
    ['dashcam', 'dash\\s*-?\\s*cam(?:era)?'],
    ['blindSpot', 'blind\\s*-?\\s*spot(?:\\s*(?:monitor|camera|view))?'],
    ['tpms', 'tpms|tyre\\s*pressure(?:\\s*monitor\\w*)?|tire\\s*pressure'],
    ['esc', 'esc|esp|stability\\s*control'],
    ['hillDescent', 'hill\\s*descent(?:\\s*control)?'],
    ['hillAssist', 'hill\\s*(?:start|hold)(?:\\s*assist)?'],
    ['rearDisc', '(?:rear|all.?wheel|four)\\s*disc(?:\\s*brakes?)?|disc\\s*brakes'],
    ['rainWipers', 'rain\\s*-?\\s*sensing(?:\\s*wipers?)?|auto(?:matic)?\\s*wipers?'],
    ['autoHeadlamps', 'auto(?:matic)?\\s*head\\s*(?:lamps?|lights?)'],
    ['ledHeadlamps', 'led\\s*head\\s*(?:lamps?|lights?)|led\\s*lights?'],
    ['ledDRL', 'drls?|day\\s*time\\s*running(?:\\s*lights?)?'],
    ['alloys', 'alloys?(?:\\s*wheels?)?'],
    ['fogLamps', 'fog\\s*(?:lamps?|lights?)'],
    ['roofRails', 'roof\\s*rails?'],
    ['rearArmrest', 'rear\\s*(?:centre\\s*|center\\s*)?arm\\s*rest'],
    ['tiltTelescopic', 'telescopic(?:\\s*steering)?|tilt\\s*(?:&|and)\\s*telescopic'],
  ].map(([k, re]) => [k, new RegExp('(?:^|\\s)(?:' + re + ')(?=\\s|$)')]);
  const STOP = /\b(cars?|vehicles?|models?|with|w\/|and|or|for|the|a|an|in|of|me|show|find|give|i|want|need|looking|that|has|have|having|which|good|new|options?|lakhs?|lacs?|lac|rs|inr|price|priced|budget|range|plus|\+|&)\b/g;
  const SORTS = { price: 'cheapest first', mileage: 'best mileage first', expert: 'top rated first' };
  function parseQuery(q) {
    let t = ' ' + q.toLowerCase().replace(/₹/g, ' ').replace(/[’',!?]/g, ' ').replace(/\s+/g, ' ') + ' ';
    const f = { body: null, fuel: null, trans: null, seats: null, min: null, max: null, brand: null, drive: null, safe: null, sort: null, feats: [], words: [], ignored: [] };
    const take = (re, fn) => { const m = t.match(re); if (m) { fn(m); t = t.replace(m[0], ' '); return true; } return false; };
    // features first, so "android auto" or "automatic climate" aren't read as a gearbox
    for (const [k, re] of FEAT_WORDS) if (FIDX[k] != null && take(re, () => {})) { if (!f.feats.includes(k)) f.feats.push(k); if (k === 'panoramic') f.feats = f.feats.filter((x) => x !== 'sunroof'); }
    if (f.feats.includes('panoramic')) f.feats = f.feats.filter((x) => x !== 'sunroof');
    const amt = (n, unit) => (/^(cr|crore|crores)$/.test(unit || '') ? +n * 100 : +n);
    const U = '\\s*(l|lakh|lakhs|lac|lacs|cr|crore|crores|k)?\\b';
    take(new RegExp('(\\d+(?:\\.\\d+)?)' + U + '\\s*(?:-|to|and)\\s*(\\d+(?:\\.\\d+)?)' + U), (m) => { f.min = amt(m[1], m[2] || m[4]); f.max = amt(m[3], m[4]); });
    take(new RegExp('(?:under|below|less than|upto|up to|within|max(?:imum)?|<|not more than|cheaper than)\\s*(?:rs\\.?\\s*)?(\\d+(?:\\.\\d+)?)' + U), (m) => { f.max = amt(m[1], m[2]); });
    take(new RegExp('(?:above|over|more than|>|min(?:imum)?|at least|starting)\\s*(?:rs\\.?\\s*)?(\\d+(?:\\.\\d+)?)' + U), (m) => { f.min = amt(m[1], m[2]); });
    take(new RegExp('(?:around|about|approx(?:imately)?|~|near|close to)\\s*(?:rs\\.?\\s*)?(\\d+(?:\\.\\d+)?)' + U), (m) => { const v = amt(m[1], m[2]); f.min = Math.round(v * 0.85 * 10) / 10; f.max = Math.round(v * 1.15 * 10) / 10; });
    take(/\b(\d+(?:\.\d+)?)\s*(l|lakh|lakhs|lac|lacs|cr|crore|crores)\b/, (m) => { f.max = amt(m[1], m[2]); });
    take(/\b(suvs?|crossovers?|compact suvs?|jeeps?)\b/, () => (f.body = 'SUV'));
    take(/\b(hatch|hatchbacks?|hatches|small cars?|city cars?)\b/, () => (f.body = 'Hatchback'));
    take(/\b(sedans?|saloons?)\b/, () => (f.body = 'Sedan'));
    take(/\b(muvs?|mpvs?|people movers?|vans?)\b/, () => (f.body = 'MUV / MPV'));
    take(/\b(evs?|electric|battery|ev cars?)\b/, () => (f.fuel = 'Electric'));
    take(/\b(diesels?)\b/, () => (f.fuel = 'Diesel'));
    take(/\b(petrols?|gasoline|turbo petrol)\b/, () => (f.fuel = 'Petrol'));
    take(/\b(cng)\b/, () => (f.fuel = 'CNG'));
    take(/\b(hybrids?|phev|plug.?in)\b/, () => (f.fuel = 'Hybrid'));
    take(/\b(automatics?|auto|amt|cvt|dct|dsg|at|ivt|torque converter|two pedal|clutchless|no clutch)\b/, () => (f.trans = 'Automatic'));
    take(/\b(manuals?|mt|stick shift|stick)\b/, () => (f.trans = 'Manual'));
    take(/\b([67]|six|seven)\s*-?\s*seat(?:er|ers|s)?\b|\b(third row|3rd row|three rows?|7 seats|big family)\b/, () => (f.seats = '6–7'));
    take(/\b([45]|four|five)\s*-?\s*seat(?:er|ers|s)?\b/, () => (f.seats = '4–5'));
    take(/\b(4x4|4wd|awd|all.?wheel drive|four.?wheel drive|off.?road(?:er|ing)?)\b/, () => (f.drive = true));
    take(/\b(5|five)\s*-?\s*star(?:\s*(?:safety|rated|rating|ncap))?\b/, () => (f.safe = 5));
    take(/\b(safest|safe|safety|ncap|crash.?tested)\b/, () => (f.safe = f.safe || 4));
    take(/\b(cheapest|cheap|affordable|budget friendly|low cost|lowest price|value)\b/, () => (f.sort = 'price'));
    take(/\b(best mileage|mileage|fuel efficient|economical|efficient|frugal)\b/, () => (f.sort = 'mileage'));
    take(/\b(best|top rated|top|highest rated|recommended|popular)\b/, () => (f.sort = f.sort || 'expert'));
    for (const b of BRANDS()) { const bl = b.toLowerCase(), alias = { 'maruti suzuki': 'maruti suzuki|maruti|suzuki|nexa', 'mercedes-benz': 'mercedes-benz|mercedes benz|mercedes|benz|merc', 'land rover': 'land rover|range rover|landrover', volkswagen: 'volkswagen|vw', 'mg': 'mg|morris garages' }[bl]; const re = new RegExp('\\b(' + (alias || bl.replace(/[-]/g, '.')) + ')\\b'); if (re.test(t)) { f.brand = b; t = t.replace(re, ' '); break; } }
    // anything left must match a model/variant name; words that match no car at all are ignored (and shown as ignored)
    const hayAll = DATA.cars.map((c) => `${c.brand} ${c.model} ${c.variant}`.toLowerCase());
    for (const w of t.replace(STOP, ' ').split(/\s+/).filter((w) => w.length > 1)) {
      const w2 = w.replace(/s$/, '');
      if (hayAll.some((h) => h.includes(w))) f.words.push(w); else if (w2.length > 1 && hayAll.some((h) => h.includes(w2))) f.words.push(w2); else f.ignored.push(w);
    }
    return f;
  }
  // what the search understood, as removable chips
  function queryParts(f) {
    if (!f) return [];
    const p = [];
    if (f.brand) p.push(['brand', f.brand]);
    if (f.words.length) p.push(['words', '“' + f.words.join(' ') + '”']);
    if (f.body) p.push(['body', { SUV: 'SUVs', Hatchback: 'Hatchbacks', Sedan: 'Sedans', 'MUV / MPV': 'MUVs / MPVs' }[f.body] || f.body]);
    if (f.fuel) p.push(['fuel', f.fuel]);
    if (f.trans) p.push(['trans', f.trans]);
    if (f.seats) p.push(['seats', f.seats + ' seats']);
    if (f.drive) p.push(['drive', '4x4 / AWD']);
    if (f.safe) p.push(['safe', f.safe === 5 ? '5-star safety' : '4★+ safety rating']);
    if (f.min || f.max) p.push(['budget', f.min && f.max ? `₹${f.min}–${f.max} L` : f.max ? `Under ₹${f.max} L` : `Over ₹${f.min} L`]);
    for (const k of f.feats) p.push(['feat:' + k, 'With ' + FLABEL(k).replace(/ \(any\)$/, '')]);
    if (f.sort) p.push(['sort', SORTS[f.sort]]);
    return p;
  }
  function qfWithout(f, part) {
    const g = { ...f, feats: f.feats.slice(), words: f.words.slice() };
    if (part.startsWith('feat:')) g.feats = g.feats.filter((k) => k !== part.slice(5));
    else if (part === 'budget') g.min = g.max = null;
    else if (part === 'words') g.words = [];
    else g[part] = null;
    return queryParts(g).length ? g : null;
  }
  const featsOn = () => (state.qf && state.qf.feats.length ? new Set([...state.feats, ...state.qf.feats]) : state.feats);
  function queryMatch(c) {
    const f = state.qf; if (!f) return true;
    if (!queryParts(f).length) return false; // nothing in the search was understood
    if (f.body && c.body !== f.body) return false;
    if (f.fuel && c.fuel !== f.fuel) return false;
    if (f.trans && c.transmission !== f.trans) return false;
    if (f.seats && seatGroup(c.seats) !== f.seats) return false;
    if (f.brand && c.brand !== f.brand) return false;
    if (f.drive && !/4x4|4wd|awd|all/i.test(c.drive || '')) return false;
    if (f.safe && !(((DATA.ncap || {})[c.brand + '|' + c.model] || {}).stars >= f.safe)) return false;
    if (f.max && c.orTotal > f.max * L) return false;
    if (f.min && c.orTotal < f.min * L) return false;
    if (f.words.length) { const hay = `${c.brand} ${c.model} ${c.variant}`.toLowerCase(); if (!f.words.every((w) => hay.includes(w))) return false; }
    return true;
  }
  function runSearch(q) {
    state.q = q.trim();
    state.qf = state.q ? parseQuery(state.q) : null;
    if (state.q && state.tab === 'foryou') state.tab = 'all';
    state.page = 1; render(); drawHints();
  }
  const HINTS = ['SUV with sunroof', 'Automatic under 10 lakh', 'Safest 7 seater', 'Electric SUV with 360 camera', 'Diesel with ventilated seats', 'Best mileage hatchback', 'Creta'];
  function drawHints() {
    const h = $('#qHints'); if (!h) return;
    h.hidden = !!state.q;
    h.innerHTML = `<span class="muted">Try</span>${HINTS.map((x) => `<button type="button" class="q-hint" data-q="${esc(x)}">${esc(x)}</button>`).join('')}`;
  }
  function wireShowroom() {
    $('#tabs').addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]'); if (t) return setTab(t.dataset.tab);
      if (e.target.closest('#openFilters')) openDrawer();
    });
    $('#shelves').addEventListener('click', (e) => {
      const s = e.target.closest('[data-see]'); if (s) return seeAll(s.dataset.see);
      const rb = e.target.closest('.rail-btn'); if (rb) { const r = rb.parentElement.querySelector('.rail'); r.scrollBy({ left: (rb.classList.contains('next') ? 1 : -1) * r.clientWidth * 0.85, behavior: 'smooth' }); return; }
      const t = e.target.closest('.tile'); if (t) openCar(t.dataset.key);
    });
    $('#shelves').addEventListener('keydown', (e) => { const t = e.target.closest('.tile'); if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openCar(t.dataset.key); } });
    $('#qHints').addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (!b) return; $('#q').value = b.dataset.q; runSearch(b.dataset.q); });
    drawHints();
    let qt; $('#q').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => runSearch(e.target.value), 250); });
    $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(qt); runSearch(e.target.value); e.target.blur(); } });
    $('#scrim').addEventListener('click', closeDrawer);
    $('#modal').addEventListener('click', (e) => {
      const box = e.target.closest('.cmp-box');
      if (box) { box.checked ? (state.compare.size < 4 ? state.compare.add(box.dataset.id) : (box.checked = false)) : state.compare.delete(box.dataset.id); updateCompareBar(); return; }
      const tr = e.target.closest('tr.v'); if (tr && !e.target.closest('input')) detail(tr.dataset.id);
    });
  }
  function openDrawer() { $('#filters').classList.add('open'); $('#scrim').hidden = false; document.body.classList.add('drawer-open'); }
  function closeDrawer() { $('#filters').classList.remove('open'); $('#scrim').hidden = true; document.body.classList.remove('drawer-open'); }

  // ---------------- UI: results ----------------
  const FLABEL = (k) => DATA.features[FIDX[k]].label;
  function render() {
    if ((activeCount() || state.q) && state.tab === 'foryou') state.tab = 'all';
    if (state.tab === 'picks' && !(state.sort === 'rec' && state.rec)) state.tab = 'all';
    drawTabs();
    const shelvesView = state.tab === 'foryou';
    $('#shelves').hidden = !shelvesView; $('#gridView').hidden = shelvesView;
    document.body.classList.toggle('rec-mode', !!(state.sort === 'rec' && state.rec));
    if (shelvesView) { drawShelves(); updateCompareBar(); return; }
    const list = results();
    const nV = list.reduce((s, m) => s + m.vs.length, 0);
    const stName = RTO.states[state.st].name;
    $('#resultTitle').textContent = list.length ? `${list.length} model${list.length > 1 ? 's' : ''} · ${nV} variants match` : 'No cars match';
    if (list.length && featsOn().size) {
      const ok = list.filter((m) => m.tier === 0).length, rest = list.length - ok;
      $('#resultTitle').textContent = ok ? `${ok} model${ok > 1 ? 's' : ''} match` : 'No confirmed matches';
      if (rest) $('#resultTitle').insertAdjacentHTML('beforeend', `<span class="rt-more"> + ${rest} more to check</span>`);
    }
    $('#resultSub').textContent = `On-road prices estimated for ${stName}.` + (featsOn().size ? ' Confirmed matches first.' : ' Use the filters to narrow down.') + (state.qf && state.qf.ignored.length ? ` Ignored: ${state.qf.ignored.join(', ')}.` : '');
    $('#activeChips').innerHTML = activeFilters().map(([spec, label]) => `<button class="chip" data-rm="${esc(spec)}">${esc(label)} ✕</button>`).join('');
    const shown = list.slice(0, state.page * PAGE);
    recBar();
    document.body.classList.toggle('rec-mode', !!(state.sort === 'rec' && state.rec));
    const recMode = state.sort === 'rec' && state.rec;
    if (recMode && list.length) $('#resultTitle').textContent = `${list.length} model${list.length > 1 ? 's' : ''} ranked for you`;
    if (recMode) $('#resultSub').textContent = `Ranked on your priorities using Autocar India expert scores plus our specs data. Click a car for its variants, safety rating and nearby showrooms.`;
    $('#list').className = recMode ? 'list' : 'tile-grid';
    $('#list').innerHTML = shown.length ? shown.map((m, i) => (!recMode && featsOn().size && m.tier > 0 && (i === 0 || shown[i - 1].tier === 0) ? `<div class="grid-split"><b>More to check</b><span class="muted">We couldn't confirm every feature for these yet. Open a car to see its variants.</span></div>` : '') + (recMode ? recCard(m, i + 1) : tile(m))).join('') : sorry();
    $('#more').hidden = list.length <= shown.length;
    updateCompareBar();
  }

  function card(m) {
    const b = m.best.c;
    const key = m.brand + '|' + m.model;
    const open = state.open.has(key);
    const partial = !m.exact && state.feats.size;
    const unknown = m.best.ev.unk.length;
    const tags = [
      `<span class="tag">${esc(m.body)}</span>`,
      ...m.fuels.map((f) => `<span class="tag">${esc(f)}</span>`),
      ...m.trans.map((t) => `<span class="tag">${esc(t)}</span>`),
      b.mileage ? `<span class="tag hide-sm">${b.fuel === 'Electric' ? '' : b.mileage + ' km/l'}</span>` : '',
      state.feats.size && m.confirmed ? `<span class="tag good">All ${state.feats.size} features ✓</span>` : '',
      partial ? `<span class="tag warn">Missing: ${esc(m.best.ev.miss.map(FLABEL).join(', '))}</span>` : '',
      unknown ? `<span class="tag warn">${unknown} not confirmed</span>` : '',
      expertOf(m) && expertOf(m).s ? `<span class="tag xtag" title="Autocar India expert score">Autocar ${esc(expertOf(m).s)}/10</span>` : '',
    ].join('');
    const img = carImg(m);
    return `<article class="card" data-key="${esc(key)}">
      <div class="card-main">
        <div class="thumb">${img}</div>
        <div><div class="brand">${esc(m.brand)}</div><h3>${esc(m.model)}</h3><div class="meta">${tags}</div></div>
        <div class="price"><div class="small">${m.vs.length > 1 ? 'Matching variants from' : 'On-road'}</div><div class="big">${lakh(m.min)}</div><div class="small">${m.vs.length > 1 ? 'up to ' + lakh(m.max) : 'ex-showroom ' + lakh(b.or.ex)}</div></div>
      </div>
      <div class="card-foot"><span class="muted">Cheapest match: <b style="color:var(--text)">${esc(b.variant)}</b></span><button class="link" data-toggle="${esc(key)}">${open ? 'Hide' : 'See'} ${m.vs.length} variant${m.vs.length > 1 ? 's' : ''}</button></div>
      ${open ? variantTable(m) : ''}
    </article>`;
  }

  function variantTable(m) {
    const rows = m.vs.slice().sort((a, b) => a.c.orTotal - b.c.orTotal).map(({ c, ev }) => `
      <tr class="v" data-id="${esc(c.id)}">
        <td><input type="checkbox" class="cmp-box" data-id="${esc(c.id)}" ${state.compare.has(c.id) ? 'checked' : ''} aria-label="Compare"></td>
        <td><b>${esc(c.variant)}</b>${ev.miss.length ? `<div class="miss">Missing: ${esc(ev.miss.map(FLABEL).join(', '))}</div>` : ''}${ev.unk.length ? `<div class="unk">Not confirmed: ${esc(ev.unk.map(FLABEL).join(', '))}</div>` : ''}</td>
        <td>${esc(c.fuel)}</td><td>${esc(c.transType && c.transType !== 'MT' ? c.transType : c.transmission || '')}</td>
        <td class="num hide-sm">${lakh(c.or.ex)}</td><td class="num"><b>${lakh(c.orTotal)}</b></td>
      </tr>`).join('');
    return `<div class="variants"><table><thead><tr><th></th><th>Variant</th><th>Fuel</th><th>Gearbox</th><th class="num hide-sm">Ex-showroom</th><th class="num">On-road*</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // ---------------- detail & compare ----------------
  const byId = (id) => DATA.cars.find((c) => c.id === id);
  const mark = (v) => (v === '1' ? '<span class="yes">✓</span>' : v === '0' ? '<span class="no">✕</span>' : '<span class="q" title="Not published by the maker">?</span>');
  function detail(id) {
    const c = byId(id);
    const o = c.or;
    const byBucket = {};
    for (const f of DATA.features) (byBucket[f.bucket] = byBucket[f.bucket] || []).push(f);
    const hasFeat = /[01]/.test(c.fs);
    $('#modalBody').innerHTML = `
      <div class="modal-head"><div><div class="brand muted">${esc(c.brand)} · ${esc(c.body)}</div><h2>${esc(c.model)} ${esc(c.variant)}</h2>
        <div class="meta">${[c.fuel, c.transType && c.transType !== 'MT' ? c.transType : c.transmission, c.drive !== '2WD' ? c.drive : '', c.seats ? c.seats + ' seats' : '', c.cc ? c.cc + ' cc' : '', c.mileage ? c.mileage + (c.fuel === 'Electric' ? '' : ' km/l') : '', c.airbags ? c.airbags + ' airbags' : ''].filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div></div>
        <button class="btn ghost" data-close aria-label="Close">✕</button></div>
      <div class="modal-body">
        <h3>On-road price in ${esc(RTO.states[state.st].name)}</h3>
        <table class="breakup"><tbody>${o.items.map(([l, v]) => `<tr><td>${esc(l)}</td><td>${inr(v)}</td></tr>`).join('')}<tr class="total"><td>Estimated on-road price</td><td>${inr(o.total)}</td></tr></tbody></table>
        ${o.approx ? '<div class="note">Road-tax rules for this state are approximate. Please confirm with the RTO or dealer.</div>' : ''}${o.note ? `<div class="note">${esc(o.note)}</div>` : ''}
        <p class="hint">Excludes optional extras (extended warranty, accessories, zero-dep insurance, handling charges) and any dealer discounts.</p>
        <h3 style="margin-top:18px">Features</h3>
        ${hasFeat ? '' : '<div class="note">This maker doesn\'t publish a variant-wise feature list on its website, so features can\'t be confirmed yet.</div>'}
        <div class="fgrid">${DATA.buckets.map((b) => `<section><h3>${esc(b)}</h3><ul>${(byBucket[b] || []).map((f) => `<li>${mark(c.feat(f.key))} ${esc(f.label)}</li>`).join('')}</ul></section>`).join('')}</div>
        <p style="margin-top:14px"><a href="${esc(c.url)}" target="_blank" rel="noopener">Official ${esc(c.brand)} page ↗</a></p>
      </div>`;
    $('#modal').showModal();
  }

  function compareView() {
    const cs = [...state.compare].map(byId).filter(Boolean);
    const head = cs.map((c) => `<th>${esc(c.brand)} ${esc(c.model)}<br><span class="muted" style="text-transform:none">${esc(c.variant)}</span></th>`).join('');
    const row = (l, fn) => `<tr><td>${esc(l)}</td>${cs.map((c) => `<td>${fn(c)}</td>`).join('')}</tr>`;
    let body = row('On-road (est.)', (c) => `<b>${inr(c.orTotal)}</b>`) + row('Ex-showroom', (c) => inr(c.or.ex)) + row('Fuel', (c) => esc(c.fuel)) + row('Gearbox', (c) => esc(c.transType || c.transmission || '')) + row('Seats', (c) => c.seats || '') + row('Mileage', (c) => c.mileage || '–');
    for (const b of DATA.buckets) {
      body += `<tr><th colspan="${cs.length + 1}">${esc(b)}</th></tr>`;
      for (const f of DATA.features.filter((f) => f.bucket === b)) body += row(f.label, (c) => mark(c.feat(f.key)));
    }
    $('#modalBody').innerHTML = `<div class="modal-head"><h2>Compare</h2><button class="btn ghost" data-close aria-label="Close">✕</button></div><div class="modal-body" style="overflow-x:auto"><table class="cmp"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    $('#modal').showModal();
  }
  function updateCompareBar() {
    const n = state.compare.size;
    $('#compareBar').hidden = !n;
    $('#compareText').textContent = `${n} selected${n < 2 ? ' — pick another to compare' : ''}`;
    $('#compareGo').disabled = n < 2;
  }

  function about() {
    const rows = DATA.brands.sort((a, b) => a.brand.localeCompare(b.brand)).map((b) => `<tr><td>${esc(b.brand)}</td><td class="num">${b.models}</td><td class="num">${b.variants}</td><td>${b.curated ? 'Curated snapshot' : 'Official site (automatic)'}</td><td>${b.updated ? new Date(b.updated).toLocaleDateString('en-IN') : ''}</td></tr>`).join('');
    $('#modalBody').innerHTML = `<div class="modal-head"><h2>Data sources &amp; coverage</h2><button class="btn ghost" data-close aria-label="Close">✕</button></div><div class="modal-body">
      <p>Every Monday a robot visits each carmaker's official Indian website and collects models, variants, ex-showroom prices and (where published) variant-wise features. Where a maker publishes state-wise prices (Hyundai, Maruti Suzuki, Toyota, Honda) those are used; otherwise the national/Delhi ex-showroom price is used.</p>
      <p>On-road prices add state road tax (from each state's published slabs), registration and number-plate fees, an insurance estimate, FASTag and TCS. Road tax rules last checked: ${esc(RTO.verified)}.</p>
      <table><thead><tr><th>Brand</th><th class="num">Models</th><th class="num">Variants</th><th>Source</th><th>Updated</th></tr></thead><tbody>${rows}</tbody></table><p class="muted">Jaguar currently has no models on sale in India (jaguar.in redirects to the global site while the brand moves to its new electric range), so there is nothing to list yet. Curated brands show the starting ex-showroom price per model; their features are not yet published variant-by-variant, so they appear as "not confirmed" when you filter by features.</p></div>`;
    $('#modal').showModal();
  }

  // ---------------- active filters, removing one, and the "sorry" state ----------------
  function activeFilters() {
    const out = [];
    for (const [part, label] of queryParts(state.qf)) out.push(['qp:' + part, label]);
    if (state.q && !queryParts(state.qf).length) out.push(['q:', `“${state.q}”`]);
    if (state.budgetMin || state.budgetMax) out.push(['budget:', state.budgetMin && state.budgetMax ? `₹${state.budgetMin}–${state.budgetMax} L` : state.budgetMax ? `Under ₹${state.budgetMax} L` : `Over ₹${state.budgetMin} L`]);
    for (const n of ['body', 'fuel', 'trans', 'seats', 'brand']) for (const v of state[n]) out.push([`${n}:${v}`, n === 'seats' ? `${v} seats` : v]);
    for (const k of state.feats) out.push([`feats:${k}`, FLABEL(k)]);
    return out;
  }
  function rmFilter(spec) {
    const [k, v] = spec.split(/:(.*)/s);
    if (k === 'budget') state.budgetMin = state.budgetMax = '';
    else if (k === 'q') { state.q = ''; state.qf = null; }
    else if (k === 'qp') { state.qf = state.qf && qfWithout(state.qf, v); if (!state.qf) state.q = ''; }
    else if (state[k] instanceof Set) state[k].delete(v);
  }
  // how many models would show if each filter were removed on its own
  function relaxOptions() {
    const snap = { q: state.q, qf: state.qf, bmin: state.budgetMin, bmax: state.budgetMax, sort: state.sort, sets: SETS.map((k) => new Set(state[k])) };
    const out = [];
    state.sort = 'price';
    for (const [spec, label] of activeFilters()) {
      rmFilter(spec);
      const n = results().length;
      if (n) out.push({ spec, label, n });
      state.q = snap.q; state.qf = snap.qf; state.budgetMin = snap.bmin; state.budgetMax = snap.bmax; SETS.forEach((k, i) => (state[k] = new Set(snap.sets[i])));
    }
    state.sort = snap.sort;
    return out.sort((a, b) => b.n - a.n);
  }
  const SORRY_ICON = `<svg class="sorry-ico" viewBox="0 0 96 72" aria-hidden="true"><path d="M10 52h76M14 52V40l10-16h40l12 14c6 1 10 6 10 14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="30" cy="53" r="7" fill="var(--panel)" stroke="currentColor" stroke-width="3"/><circle cx="70" cy="53" r="7" fill="var(--panel)" stroke="currentColor" stroke-width="3"/><circle cx="41" cy="34" r="2" fill="currentColor"/><circle cx="55" cy="34" r="2" fill="currentColor"/><path d="M41 44c3-3.5 11-3.5 14 0" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;
  function sorry() {
    const opts = relaxOptions();
    return `<div class="empty sorry">${SORRY_ICON}<h2>Sorry, no cars match all of that</h2>
      ${opts.length ? `<p class="muted">Remove one of these to see cars that fit the rest:</p>
      <div class="relax">${opts.map((o) => `<button class="relax-btn" type="button" data-rm="${esc(o.spec)}"><span>Remove <b>${esc(o.label)}</b></span><em>${o.n} car${o.n > 1 ? 's' : ''} <span aria-hidden="true">→</span></em></button>`).join('')}</div>` : '<p class="muted">Nothing comes up even with one filter removed.</p>'}
      <button class="link" type="button" data-rm="*">Clear all filters</button></div>`;
  }

  // ---------------- car page: #/car/<brand-model> ----------------
  const mslug = (b, m) => (b + ' ' + m).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const modelBySlug = (s) => groupAll().find((m) => mslug(m.brand, m.model) === s);
  let navFromList = false;
  function openCar(key) { const [b, m] = key.split('|'); navFromList = true; go('car', mslug(b, m)); }
  const cp = { key: null, fuel: new Set(), gear: new Set(), need: new Set(), all: false };
  const gearTxt = (c) => (c.transmission === 'Manual' ? 'Manual' : ({ AMT: 'AMT', AT: 'Automatic', CVT: 'CVT', 'e-CVT': 'e-CVT', DCT: 'DCT' }[c.transType] || c.transmission || '–'));
  const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.3l-5.8 3.1 1.2-6.5L2.6 9.4l6.5-.8z"/></svg>';
  const stars = (n) => `<span class="stars" aria-label="${n} out of 5 stars">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}">${STAR}</i>`).join('')}</span>`;
  const ORIG_TITLE = document.title;

  function renderCar(slug) {
    const el = $('#carPage'), m = modelBySlug(slug);
    if (!m) { el.innerHTML = `<div class="cp-wrap"><div class="empty sorry">${SORRY_ICON}<h2>Sorry, we couldn't find that car</h2><p class="muted">It may have been discontinued or renamed.</p><a class="btn primary" href="#/cars" data-go="cars">Browse all cars</a></div></div>`; return; }
    const key = m.brand + '|' + m.model;
    if (cp.key !== key) { cp.key = key; cp.fuel.clear(); cp.gear.clear(); cp.need.clear(); cp.all = false; cp.more = false; }
    const x = expertOf(m), nc = (DATA.ncap || {})[key], usp = (DATA.usp || {})[key];
    const st = RTO.states[state.st].name;
    document.title = `${m.brand} ${m.model}: on-road price in ${st}, variants & showrooms · Right Ride`;
    const seats = [...new Set(m.vs.map((v) => v.c.seats).filter(Boolean))].sort();
    const tags = [...m.fuels, ...m.trans, seats.length ? seats.join(' / ') + ' seats' : '', `${m.vs.length} variant${m.vs.length > 1 ? 's' : ''}`].filter(Boolean);
    const max = { 'Bharat NCAP': [32, 49], 'Global NCAP': [34, 49] }[nc && nc.by] || [null, null];
    const safety = nc ? `<div class="nc-top">${stars(nc.stars)}<div><b>${nc.stars}-star</b> adult safety<div class="muted small">${esc(nc.by)}</div></div></div>
        ${nc.aop != null || nc.cop != null ? `<div class="nc-bars">${nc.aop != null ? `<div><span>Adult occupant</span>${bar10(nc.aop / max[0] * 10)}<b>${nc.aop}${max[0] ? `<small>/${max[0]}</small>` : ''}</b></div>` : ''}${nc.cop != null ? `<div><span>Child occupant</span>${bar10(nc.cop / max[1] * 10)}<b>${nc.cop}${max[1] ? `<small>/${max[1]}</small>` : ''}</b></div>` : ''}</div>` : ''}
        ${nc.note ? `<p class="note">${esc(nc.note)}</p>` : ''}`
      : `<p class="muted">Not crash-tested by Bharat NCAP or Global NCAP yet. ${m.vs.some((v) => v.c.airbags) ? `Comes with up to ${Math.max(...m.vs.map((v) => v.c.airbags || 0))} airbags.` : ''}</p>`;
    $('#carPage').innerHTML = `<div class="cp-wrap">
      <button class="cp-back" type="button" data-back><span aria-hidden="true">‹</span> All cars</button>
      <section class="cp-hero">
        <div class="cp-img">${carImg(m, '(max-width: 900px) 92vw, 640px')}</div>
        <div class="cp-info">
          <div class="cp-eyebrow">${esc(m.brand)} · ${esc(m.body)}</div>
          <h1 class="display cp-title">${esc(m.model)}</h1>
          <div class="muted small">On-road price in ${esc(st)}</div>
          <div class="cp-price">${lakh(m.min)}${m.max > m.min ? ` <span>– ${lakh(m.max)}</span>` : ''}</div>
          <div class="cp-tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
          <div class="cp-badges">${x && x.s ? `<span class="cp-badge"><b>${esc(x.s)}</b><small>/10</small><span>Autocar India</span></span>` : ''}${nc ? `<a class="cp-badge nc" href="#cpSafety"><b>${nc.stars}★</b><span>${esc(nc.by)}</span></a>` : ''}</div>
          <div class="sheet-cta"><a class="btn primary" href="#cpVariants" data-jump="cpVariants">Find my variant</a><a class="btn ghost" href="#cpDealers" data-jump="cpDealers">Showrooms near me</a></div>
        </div>
      </section>
      ${usp && usp.length ? `<section class="cp-sec cp-usp"><div class="cp-sec-head"><h2 class="display">Why people pick it</h2><span class="ai-tag"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2l1.8 5.6L19.5 9l-5.7 1.6L12 16l-1.8-5.4L4.5 9l5.7-1.4zM19 15l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9z"/></svg>AI summary of expert reviews</span></div>
        <ol class="usp">${usp.map((u) => `<li>${esc(u)}</li>`).join('')}</ol></section>` : ''}
      <div class="cp-two">
        <section class="cp-sec" id="cpSafety"><div class="cp-sec-head"><h2 class="display">Safety rating</h2></div>${safety}</section>
        <section class="cp-sec"><div class="cp-sec-head"><h2 class="display">Expert view</h2>${x && x.s ? `<span class="xbadge">Autocar ${esc(x.s)}/10</span>` : ''}</div>
          ${x ? `<ul class="pc">${x.like.map((t) => `<li class="pro">${esc(t)}</li>`).join('')}${x.dislike.map((t) => `<li class="con">${esc(t)}</li>`).join('')}</ul>${x.basedOn ? `<p class="muted small">From the review of the ${esc(x.basedOn)}.</p>` : ''}` : '<p class="muted">No Autocar India review yet.</p>'}
          <div class="cp-links"><a class="watch" href="${esc(ytUrl(m))}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21.6 7.2a2.7 2.7 0 0 0-1.9-1.9C18 4.8 12 4.8 12 4.8s-6 0-7.7.5A2.7 2.7 0 0 0 2.4 7.2 28 28 0 0 0 2 12a28 28 0 0 0 .4 4.8 2.7 2.7 0 0 0 1.9 1.9c1.7.5 7.7.5 7.7.5s6 0 7.7-.5a2.7 2.7 0 0 0 1.9-1.9A28 28 0 0 0 22 12a28 28 0 0 0-.4-4.8zM10 15.1V8.9l5.2 3.1z"/></svg>Watch the video review</a>${x && x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">Read the review ↗</a>` : ''}<a href="${esc(m.url)}" target="_blank" rel="noopener">Official site ↗</a></div>
        </section>
      </div>
      <section class="cp-sec" id="cpVariants"></section>
      <section class="cp-sec" id="cpDealers"></section>
    </div>`;
    drawVariants(m); drawDealers(m);
  }

  // variant helper: only what differs between variants, the cheapest one with everything you ticked
  function drawVariants(m) {
    const box = $('#cpVariants'); if (!box) return;
    const all = m.vs.map((v) => v.c).sort((a, b) => a.orTotal - b.orTotal);
    const fuels = [...new Set(all.map((c) => c.fuel))], gears = [...new Set(all.map((c) => c.transmission).filter(Boolean))];
    const pool = all.filter((c) => (!cp.fuel.size || cp.fuel.has(c.fuel)) && (!cp.gear.size || cp.gear.has(c.transmission)));
    const known = pool.filter((c) => /[01]/.test(c.fs));
    const diff = DATA.features.filter((f) => { const v = known.map((c) => c.feat(f.key)); return v.includes('1') && v.some((x) => x !== '1'); });
    const cell = (c, k) => { const v = c.feat(k); return v === '?' && diff.some((f) => f.key === k) ? '<span class="no" title="Not listed for this variant">–</span>' : mark(v); };
    for (const k of [...cp.need]) if (!diff.some((f) => f.key === k)) cp.need.delete(k);
    const ok = (c) => [...cp.need].every((k) => c.feat(k) === '1');
    const match = pool.filter(ok), best = match[0];
    if (cp.need.size) pool.sort((a, b) => ok(b) - ok(a) || a.orTotal - b.orTotal); // variants with everything you ticked come first
    const rng = (c) => (c.fuel === 'Electric' ? (c.range ? c.range + ' km range' : '–') : c.mileage ? c.mileage + ' km/l' : '–');
    const SPECS = [['Fuel', (c) => c.fuel], ['Gearbox', gearTxt], ['Drive', (c) => c.drive || '–'], ['Seats', (c) => c.seats || '–'], ['Airbags', (c) => c.airbags || '–'], ['Mileage', rng], ['Engine', (c) => (c.cc ? c.cc + ' cc' : '–')]];
    const specs = cp.all ? SPECS : SPECS.filter(([, fn]) => new Set(pool.map(fn)).size > 1);
    const rows = cp.all ? DATA.features.filter((f) => known.some((c) => c.feat(f.key) !== '?')) : diff;
    const ordered = [...rows.filter((f) => cp.need.has(f.key)), ...rows.filter((f) => !cp.need.has(f.key))];
    let pick = '';
    if (best) {
      const nxt = all.find((c) => c.orTotal > best.orTotal && c.fuel === best.fuel && c.transmission === best.transmission && /[01]/.test(c.fs));
      const adds = nxt ? DATA.features.filter((f) => best.feat(f.key) !== '1' && nxt.feat(f.key) === '1') : [];
      pick = `<div class="vh-pick"><div class="vh-pick-k">${cp.need.size ? 'Your Right variant' : 'Cheapest variant'}${cp.fuel.size || cp.gear.size ? ' for your choice' : ''}</div>
        <div class="vh-pick-main"><div><h3>${esc(best.variant)}</h3><div class="muted small">${esc([best.fuel, gearTxt(best)].join(' · '))}${cp.need.size ? ` · has all ${cp.need.size} feature${cp.need.size > 1 ? 's' : ''} you picked` : ''}${match.length > 1 ? ` · ${match.length - 1} more variant${match.length > 2 ? 's' : ''} also fit` : ''}</div></div>
        <div class="vh-pick-p"><b>${lakh(best.orTotal)}</b><span class="muted small">on-road · ex-showroom ${lakh(best.or.ex)}</span></div></div>
        ${adds.length ? `<div class="vh-up">Step up to <b>${esc(nxt.variant)}</b> (+${lakh(nxt.orTotal - best.orTotal).replace('₹', '₹')}) for ${esc(adds.slice(0, 5).map((f) => f.label).join(', '))}${adds.length > 5 ? ` and ${adds.length - 5} more` : ''}.</div>` : ''}
        <button class="link" type="button" data-vid="${esc(best.id)}">Price break-up and all features ›</button></div>`;
    } else pick = `<div class="vh-pick none">${SORRY_ICON}<div><b>Sorry, no ${esc(m.model)} variant has all of that.</b><div class="muted small">Untick a feature to see the closest variants.</div></div></div>`;
    const grp = (name, vals, set) => vals.length > 1 ? `<div class="group"><div class="label">${name}</div><div class="chips">${vals.map((v) => `<button type="button" class="chip" data-cpf="${name === 'Fuel' ? 'fuel' : 'gear'}" data-v="${esc(v)}" aria-pressed="${set.has(v)}">${esc(v)}</button>`).join('')}</div></div>` : '';
    const cnt = (k) => known.filter((c) => c.feat(k) === '1').length;
    box.innerHTML = `<div class="cp-sec-head"><div><h2 class="display">Find your variant</h2><p class="muted">${all.length} variant${all.length > 1 ? 's' : ''}. Tick what you care about. We only show what changes between them.${all.some((c) => c.fsrc === 'autocar' || c.zw) ? ` Some details from ${[all.some((c) => c.fsrc === 'autocar') && 'Autocar India', all.some((c) => c.zw) && 'ZigWheels'].filter(Boolean).join(' and ')}.` : ''}</p></div></div>
      ${all.length > 1 ? `<div class="vh-filters">${grp('Fuel', fuels, cp.fuel)}${grp('Gearbox', gears, cp.gear)}</div>
      ${diff.length ? `<div class="group"><div class="label">Features that differ <span class="muted">· tap the ones you want</span></div><div class="chips vh-need">${(cp.more ? diff : diff.filter((f, i) => i < 12 || cp.need.has(f.key))).map((f) => `<button type="button" class="chip" data-need="${f.key}" aria-pressed="${cp.need.has(f.key)}">${esc(f.label)}<small>${cnt(f.key)}/${known.length}</small></button>`).join('')}${diff.length > 12 ? `<button type="button" class="chip more" data-more>${cp.more ? 'Fewer' : `+${diff.filter((f, i) => i >= 12 && !cp.need.has(f.key)).length} more`}</button>` : ''}</div></div>`
        : known.length ? '<p class="muted">These variants have the same feature list.</p>' : `<div class="note">${esc(m.brand)} doesn't publish a variant-wise feature list, so we can only compare prices and specs here.</div>`}` : ''}
      ${pick}
      <div class="vh-scroll"><table class="vh-table"><thead><tr><th class="vh-c0">Variant</th>${pool.map((c) => `<th class="${c === best ? 'best' : ok(c) ? '' : 'off'}"><button type="button" data-vid="${esc(c.id)}"><span class="vh-vn">${esc(c.variant)}</span><b>${lakh(c.orTotal)}</b>${c === best ? '<em>Best fit</em>' : ''}</button></th>`).join('')}</tr></thead>
        <tbody>${specs.map(([l, fn]) => `<tr class="spec"><td class="vh-c0">${l}</td>${pool.map((c) => `<td class="${c === best ? 'best' : ok(c) ? '' : 'off'}">${esc(fn(c))}</td>`).join('')}</tr>`).join('')}
        ${ordered.map((f) => `<tr class="${cp.need.has(f.key) ? 'want' : ''}"><td class="vh-c0">${esc(f.label)}</td>${pool.map((c) => `<td class="${c === best ? 'best' : ok(c) ? '' : 'off'}">${cell(c, f.key)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${known.length ? `<label class="toggle vh-all"><input type="checkbox" data-cpall ${cp.all ? 'checked' : ''}> Also show features every variant shares</label>` : ''}`;
  }

  // dealers: nearest showrooms of this brand, from OpenStreetMap, each linked to its Google Maps page
  let DEALERS = null;
  const loadDealers = () => DEALERS || (DEALERS = fetch('data/dealers.json').then((r) => (r.ok ? r.json() : [])).catch(() => []));
  const kmBetween = (a, b, c, d) => { const r = Math.PI / 180, h = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
  const nearestCity = (la, lo) => { let best = null, bd = Infinity; for (const [name, , a, b] of RTO.cities) { const d = kmBetween(la, lo, a, b); if (d < bd) { bd = d; best = name; } } return best; };
  const PHONE = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>';
  const PIN = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
  function drawDealers(m) {
    const box = $('#cpDealers'); if (!box) return;
    const geo = store.get('geo', null);
    box.innerHTML = `<div class="cp-sec-head"><div><h2 class="display">${esc(m.brand)} showrooms near you</h2><p class="muted">Nearest first, with phone numbers where they're listed. Open any of them on Google Maps for reviews, ratings and opening hours.</p></div></div>
      <form class="dl-find" data-dlform><button type="button" class="btn ghost" data-dl="geo">${PIN} Use my location</button><span class="muted">or</span>
        <input class="dl-pin" name="pin" inputmode="numeric" autocomplete="postal-code" maxlength="6" pattern="[1-9][0-9]{5}" placeholder="Enter pincode" aria-label="Pincode"><button class="btn primary" type="submit">Find</button></form>
      <div id="dlList" aria-live="polite"></div>`;
    if (geo) listDealers(m, geo);
  }
  async function listDealers(m, geo) {
    const out = $('#dlList'); if (!out) return;
    out.innerHTML = `<p class="muted">Looking for ${esc(m.brand)} showrooms near ${esc(geo.label)}…</p>`;
    const all = await loadDealers();
    if (!$('#dlList') || cp.key !== m.brand + '|' + m.model) return;
    const near = all.filter((d) => d.b === m.brand).map((d) => ({ ...d, km: kmBetween(geo.la, geo.lo, d.la, d.lo) })).filter((d) => d.km <= 120).sort((a, b) => a.km - b.km).slice(0, 8);
    const gAll = `https://www.google.com/maps/search/${encodeURIComponent(m.brand + ' showroom')}/@${geo.la.toFixed(5)},${geo.lo.toFixed(5)},12z`;
    out.innerHTML = `<div class="dl-where">${PIN} Near <b>${esc(geo.label)}</b> <button class="link" type="button" data-dl="change">Change</button></div>
      ${near.length ? `<ol class="dl-list">${near.map(dealerCard).join('')}</ol>` : `<p class="muted">We don't have any ${esc(m.brand)} showrooms on our map within 120 km yet.</p>`}
      <a class="btn ghost dl-all" href="${gAll}" target="_blank" rel="noopener">See every ${esc(m.brand)} showroom near ${esc(geo.label)} on Google Maps ↗</a>
      <p class="hint">Showroom list from OpenStreetMap, refreshed weekly. Call ahead to check stock and test-drive cars.</p>`;
  }
  function dealerCard(d) {
    const area = d.c || nearestCity(d.la, d.lo);
    const addr = [d.a, area, d.p].filter(Boolean).join(', ');
    const gm = `https://www.google.com/maps/search/${encodeURIComponent(d.n + (area ? ', ' + area : ''))}/@${d.la},${d.lo},17z`;
    const dir = `https://www.google.com/maps/dir/?api=1&destination=${d.la},${d.lo}`;
    const tel = d.t ? d.t.replace(/[^\d+]/g, '') : '';
    return `<li class="dl"><div class="dl-main"><b class="dl-n">${esc(d.n)}</b><div class="dl-a">${esc(addr || 'Address not listed')}</div>
      <div class="dl-meta"><span class="dl-km">${d.km < 10 ? d.km.toFixed(1) : Math.round(d.km)} km away</span>${tel ? `<a class="dl-tel" href="tel:${esc(tel)}">${PHONE} ${esc(d.t)}</a>` : '<span class="muted">Phone number on Google Maps</span>'}</div></div>
      <div class="dl-act"><a class="btn primary" href="${esc(gm)}" target="_blank" rel="noopener">Google Maps ↗</a><a class="link" href="${esc(dir)}" target="_blank" rel="noopener">Directions</a></div></li>`;
  }
  async function pinToGeo(pin) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?postalcode=${pin}&country=India&format=json&limit=1&addressdetails=0`, { headers: { 'Accept-Language': 'en' } });
      const j = await r.json();
      if (j && j[0]) { const place = j[0].display_name.split(',').map((t) => t.trim()).find((t) => !/^\d+$/.test(t)); return { la: +j[0].lat, lo: +j[0].lon, label: pin + (place ? ` (${place})` : '') }; }
    } catch (e) {}
    const all = await loadDealers();
    for (const n of [6, 5, 4, 3]) { const h = all.filter((d) => d.p && d.p.slice(0, n) === pin.slice(0, n)); if (h.length) { const la = h.reduce((s, d) => s + d.la, 0) / h.length, lo = h.reduce((s, d) => s + d.lo, 0) / h.length; return { la, lo, label: `${pin} (${nearestCity(la, lo)})` }; } }
    return null;
  }
  function wireCarPage() {
    const P = $('#carPage');
    P.addEventListener('click', (e) => {
      const m = modelBySlug(carSlug); if (!m) return;
      if (e.target.closest('[data-back]')) { if (navFromList && history.length > 1) history.back(); else go('cars'); return; }
      const j = e.target.closest('[data-jump]'); if (j) { e.preventDefault(); $('#' + j.dataset.jump).scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      const v = e.target.closest('[data-vid]'); if (v) { detail(v.dataset.vid); return; }
      const f = e.target.closest('[data-cpf]'); if (f) { const set = cp[f.dataset.cpf]; set.has(f.dataset.v) ? set.delete(f.dataset.v) : set.add(f.dataset.v); return keepY(() => drawVariants(m)); }
      if (e.target.closest('[data-more]')) { cp.more = !cp.more; return keepY(() => drawVariants(m)); }
      const n = e.target.closest('[data-need]'); if (n) { cp.need.has(n.dataset.need) ? cp.need.delete(n.dataset.need) : cp.need.add(n.dataset.need); return keepY(() => drawVariants(m)); }
      const d = e.target.closest('[data-dl]');
      if (d && d.dataset.dl === 'change') { store.set('geo', null); drawDealers(m); $('.dl-pin').focus(); return; }
      if (d && d.dataset.dl === 'geo') {
        if (!navigator.geolocation) { $('#dlList').innerHTML = '<p class="muted">Location isn\'t available in this browser. Enter your pincode instead.</p>'; return; }
        $('#dlList').innerHTML = '<p class="muted">Finding you…</p>';
        navigator.geolocation.getCurrentPosition((p) => { const g = { la: p.coords.latitude, lo: p.coords.longitude }; g.label = nearestCity(g.la, g.lo) || 'you'; store.set('geo', g); listDealers(m, g); },
          () => { $('#dlList').innerHTML = '<p class="muted">We couldn\'t get your location. Enter your pincode instead.</p>'; $('.dl-pin').focus(); }, { timeout: 12000, maximumAge: 3600e3 });
      }
    });
    P.addEventListener('change', (e) => { if (e.target.matches('[data-cpall]')) { cp.all = e.target.checked; const m = modelBySlug(carSlug); if (m) keepY(() => drawVariants(m)); } });
    P.addEventListener('submit', async (e) => {
      if (!e.target.matches('[data-dlform]')) return; e.preventDefault();
      const m = modelBySlug(carSlug), pin = (e.target.pin.value || '').replace(/\D/g, '');
      if (!/^[1-9]\d{5}$/.test(pin)) { $('#dlList').innerHTML = '<p class="muted">Please enter a 6-digit pincode.</p>'; return; }
      $('#dlList').innerHTML = `<p class="muted">Looking up ${pin}…</p>`;
      const g = await pinToGeo(pin);
      if (!g) { $('#dlList').innerHTML = `<p class="muted">We couldn't find pincode ${pin}. <a href="https://www.google.com/maps/search/${encodeURIComponent(m.brand + ' showroom near ' + pin)}" target="_blank" rel="noopener">Search Google Maps for ${esc(m.brand)} showrooms near ${pin} ↗</a></p>`; return; }
      store.set('geo', g); listDealers(m, g);
    });
  }
  // redraw part of the page without the page jumping
  function keepY(fn) { const y = window.scrollY; fn(); window.scrollTo({ top: y, behavior: 'instant' }); }

  // ---------------- personalised recommendations ----------------
  const PRIO = { features: 'Features', mileage: 'Mileage', comfort: 'Comfort', value: 'Value for money' };
  const PRIO_HINT = { features: 'Tech, safety and convenience kit', mileage: 'Fuel efficiency / range', comfort: 'Space, seats and ride quality', value: 'Most car for the money' };
  const BODY_OPTS = { small: { label: 'Small car', sub: 'Hatchbacks — easy to park', bodies: ['Hatchback'] }, sedan: { label: 'Sedan', sub: 'Boot, comfort, highway manners', bodies: ['Sedan'] }, suv: { label: 'SUV', sub: 'SUVs and 7-seat MUVs', bodies: ['SUV', 'MUV / MPV'] } };
  const expertOf = (m) => (DATA.experts || {})[m.brand + '|' + m.model] || null;
  const ytUrl = (m) => { const x = expertOf(m); return x && x.yt ? `https://www.youtube.com/watch?v=${x.yt}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(`Autocar India ${m.brand} ${m.model} review`)}`; };
  const onesOf = (c) => (/[01]/.test(c.fs) ? c.fs.split('1').length - 1 : null);

  function pickVariant(m) {
    const p = state.rec.prio[0], vs = m.vs.map((x) => x.c);
    const cheap = (a, b) => a.orTotal - b.orTotal;
    if (p === 'value') return vs.slice().sort(cheap)[0];
    if (p === 'mileage') return vs.slice().sort((a, b) => (b.mileage || 0) - (a.mileage || 0) || cheap(a, b))[0];
    // features / comfort first: the best-equipped variant that fits the budget
    return vs.slice().sort((a, b) => (onesOf(b) ?? 0) - (onesOf(a) ?? 0) || b.orTotal - a.orTotal)[0];
  }
  function scoreRecs(list) {
    const pct = (arr, v) => (v == null || !arr.length ? null : arr.filter((x) => x <= v).length / arr.length);
    for (const m of list) m.pick = pickVariant(m);
    const feats = list.map((m) => onesOf(m.pick)).filter((x) => x != null).sort((a, b) => a - b);
    const miles = list.map((m) => (m.pick.fuel === 'Electric' ? null : m.pick.mileage)).filter(Boolean).sort((a, b) => a - b);
    const budget = state.rec.budget * 1e5;
    const w = [0.4, 0.3, 0.2, 0.1];
    for (const m of list) {
      const x = expertOf(m), sc = (x && x.sc) || {}, base = x && x.s ? x.s : null;
      m.est = {};
      const mix = (a, b, k) => { if (a == null && b == null) m.est[k] = true; return a != null && b != null ? 0.6 * a + 0.4 * b : a ?? b ?? (base ?? 6) - 0.5; }; // unrated: a little below the overall score
      const fN = pct(feats, onesOf(m.pick)), mN = m.pick.fuel === 'Electric' ? 0.95 : pct(miles, m.pick.mileage);
      const priceN = Math.max(0, Math.min(1, 1 - m.pick.orTotal / budget + 0.3));
      m.sub = {
        features: mix(sc.features, fN == null ? null : 3 + fN * 7, 'features'),
        mileage: mix(sc.mileage, mN == null ? null : 3 + mN * 7, 'mileage'),
        comfort: mix(sc.comfort, null, 'comfort'),
        value: mix(sc.value, 3 + priceN * 7, 'value'),
      };
      const t = state.rec.prio.reduce((s, k, i) => s + w[i] * m.sub[k], 0);
      m.match = Math.round((0.85 * t + 0.15 * (base ?? 6)) * 10) / 10;
      m.expert = x;
    }
  }
  // Priorities: the only thing shown above the ranked list, and it can be reordered at any time
  function recBar() {
    const r = state.rec, bar = $('#recBar');
    if (!r) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.innerHTML = `<span class="rec-k">Priorities</span>
      <ol class="pr-row" id="prRow" aria-label="Your priorities, most important first">${r.prio.map((k, i) => `<li class="pr-pill" data-k="${k}" tabindex="0" title="${i ? 'Tap to make this #1' : 'Most important'}" role="button"><span class="pn">${i + 1}</span><span class="pr-t">${esc(PRIO[k])}</span></li>`).join('')}</ol>
      <span class="pr-hint muted">Tap one to make it #1. The ranking updates instantly</span>`;
  }
  function setPrio(order) {
    if (!state.rec || order.join() === state.rec.prio.join()) return;
    state.rec.prio = order; store.set('rec', state.rec); render();
    const row = $('#prRow'); if (row) row.classList.add('changed');
  }
  function wirePrioBar() {
    const bar = $('#recBar'); let drag = null, barDragged = false;
    bar.addEventListener('click', (e) => {
      if (barDragged) return;
      const li = e.target.closest('.pr-pill'); if (!li || !state.rec) return;
      const k = li.dataset.k, o = [k, ...state.rec.prio.filter((x) => x !== k)]; setPrio(o);
      const f = $(`.pr-pill[data-k="${k}"]`); if (f) f.focus();
    });
    bar.addEventListener('keydown', (e) => {
      const li = e.target.closest('.pr-pill'); if (!li || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault(); const d = /Left|Up/.test(e.key) ? -1 : 1, k = li.dataset.k, o = state.rec.prio.slice(), i = o.indexOf(k), j = i + d;
      if (j < 0 || j > 3) return; [o[i], o[j]] = [o[j], o[i]]; setPrio(o); $(`.pr-pill[data-k="${k}"]`).focus();
    });
    bar.addEventListener('pointerdown', (e) => {
      const li = e.target.closest('.pr-pill'); if (!li || e.target.closest('button')) return;
      drag = { li, id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false }; li.setPointerCapture(e.pointerId);
    });
    bar.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved) { if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return; drag.moved = true; drag.li.classList.add('dragging'); }
      const row = drag.li.parentElement, items = $$('.pr-pill', row).filter((x) => x !== drag.li);
      const before = items.find((x) => { const r = x.getBoundingClientRect(); return e.clientY < r.top || (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2); });
      before ? row.insertBefore(drag.li, before) : row.appendChild(drag.li);
      $$('.pr-pill', row).forEach((x, i) => (x.querySelector('.pn').textContent = i + 1));
    });
    const end = () => { if (!drag) return; drag.li.classList.remove('dragging'); const o = $$('.pr-pill', drag.li.parentElement).map((x) => x.dataset.k); const moved = drag.moved; drag = null; if (moved) { barDragged = true; setTimeout(() => (barDragged = false), 50); setPrio(o); } };
    bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
  }
  function applyRec(r) {
    state.rec = r; store.set('rec', r); state.tab = 'picks'; state.q = ''; state.qf = null; if ($('#q')) $('#q').value = '';
    for (const k of SETS) state[k].clear();
    BODY_OPTS[r.body].bodies.forEach((b) => state.body.add(b));
    if (r.trans !== 'Either') state.trans.add(r.trans);
    if (r.fuel && r.fuel !== 'Any') state.fuel.add(r.fuel);
    state.budgetMin = ''; state.budgetMax = String(r.budget);
    state.sort = 'rec'; $('#sort').value = 'rec'; $('#sort option[value="rec"]').hidden = false;
    state.page = 1; state.open.clear();
    saveFilters(); buildFilters(); render(); go('cars'); window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function exitRec() {
    state.rec = null; store.set('rec', null); state.tab = 'foryou';
    for (const k of SETS) state[k].clear(); state.budgetMin = state.budgetMax = '';
    state.sort = 'price'; $('#sort').value = 'price'; $('#sort option[value="rec"]').hidden = true;
    saveFilters(); buildFilters(); render();
  }
  const bar10 = (v) => `<span class="sbar"><i style="width:${Math.max(4, Math.min(100, v * 10))}%"></i></span>`;
  function recCard(m, rank) {
    const c = m.pick, x = m.expert, key = m.brand + '|' + m.model, open = state.open.has(key);
    const img = carImg(m);
    const pros = x ? x.like.map((t) => `<li class="pro">${esc(t)}</li>`).join('') + x.dislike.map((t) => `<li class="con">${esc(t)}</li>`).join('') : '';
    return `<article class="card rec-card" data-yt="${esc(ytUrl(m))}" data-key="${esc(key)}">
      <div class="card-main">
        <div class="thumb">${img}<span class="rank">#${rank}</span></div>
        <div>
          <div class="brand">${esc(m.brand)}</div><h3>${esc(m.model)}</h3>
          <div class="meta"><span class="tag">${esc(c.variant)}</span><span class="tag">${esc(c.fuel)}</span><span class="tag">${esc(c.transType && c.transType !== 'MT' ? c.transType : c.transmission)}</span>${c.mileage && c.fuel !== 'Electric' ? `<span class="tag hide-sm">${c.mileage} km/l</span>` : ''}</div>
          <div class="subs">${state.rec.prio.map((k) => `<div class="sub${m.est[k] ? ' est' : ''}"${m.est[k] ? ' title="Not rated separately by Autocar India and not published by the maker; estimated from the overall score"' : ''}><span>${esc(PRIO[k])}</span>${bar10(m.sub[k])}<b>${m.est[k] ? '~' : ''}${m.sub[k].toFixed(1)}</b></div>`).join('')}</div>
        </div>
        <div class="price"><div class="match"><b>${m.match.toFixed(1)}</b><span>/10 match</span></div><div class="big">${lakh(c.orTotal)}</div><div class="small">on-road · ex-showroom ${lakh(c.or.ex)}</div></div>
      </div>
      ${x ? `<div class="expert"><div class="xs"><span class="xbadge">Autocar ${x.s ? esc(x.s) + '/10' : 'review'}</span>${x.basedOn ? `<span class="muted"> (review of the ${esc(x.basedOn)})</span>` : ''}</div><ul class="pc">${pros}</ul></div>` : `<div class="expert"><span class="muted">No Autocar India expert review yet — ranked on specs.</span></div>`}
      <div class="card-foot"><a class="watch" href="${esc(ytUrl(m))}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21.6 7.2a2.7 2.7 0 0 0-1.9-1.9C18 4.8 12 4.8 12 4.8s-6 0-7.7.5A2.7 2.7 0 0 0 2.4 7.2 28 28 0 0 0 2 12a28 28 0 0 0 .4 4.8 2.7 2.7 0 0 0 1.9 1.9c1.7.5 7.7.5 7.7.5s6 0 7.7-.5a2.7 2.7 0 0 0 1.9-1.9A28 28 0 0 0 22 12a28 28 0 0 0-.4-4.8zM10 15.1V8.9l5.2 3.1z"/></svg>${x && x.yt ? 'Watch the Autocar India review' : 'Find the Autocar India video'}</a>
        <span class="foot-links">${x && x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">Expert review ↗</a>` : ''}<button class="link" data-toggle="${esc(key)}">${open ? 'Hide' : 'See'} ${m.vs.length} variant${m.vs.length > 1 ? 's' : ''}</button></span></div>
      ${open ? variantTable(m) : ''}
    </article>`;
  }

  // ---- welcome question + 4-step builder ----
  const wz = { step: 0, a: null, picked: [] };

  const defaults = () => ({ body: null, budget: '', fuel: null, trans: null, prio: ['features', 'mileage', 'comfort', 'value'] });
  function openWizard(step = 0) {
    wz.a = Object.assign(defaults(), state.rec ? JSON.parse(JSON.stringify(state.rec)) : {});
    wz.step = step; drawWizard();
    const d = $('#wizard'); if (!d.open) d.showModal();
  }
  function closeWizard() { $('#wizard').close(); }
  function drawWizard() {
    const a = wz.a, s = wz.step, W = $('#wizardBody');
    const dots = s ? `<div class="wz-steps" aria-label="Step ${s} of 5">${[1, 2, 3, 4, 5].map((i) => `<span class="${i < s ? 'done' : i === s ? 'on' : ''}"></span>`).join('')}<em>Step ${s} of 5</em></div>` : '';
    const close = `<button class="wz-x" type="button" data-wz="close" aria-label="Close">✕</button>`;
    let body = '', canNext = true;
    if (s === 0) {
      body = `<img class="wz-mark" src="brand/logo-red-black.svg" alt="Right Ride"><h2 id="wzTitle" class="display">What can we help you with?</h2>
        <div class="wz-choices two">
          <button class="wz-opt" type="button" data-wz="browse"><b>Just browsing</b><span>Explore every car, variant and on-road price</span></button>
          <button class="wz-opt primary" type="button" data-wz="start" autofocus><b>Find the Right Ride for me!</b><span>Personalised recommendations in 5 quick steps</span></button>
        </div>`;
    } else if (s === 1) {
      canNext = !!a.body;
      body = `<h2 id="wzTitle" class="display">Small car, Sedan, or SUV?</h2>
        <div class="wz-choices three">${Object.entries(BODY_OPTS).map(([k, o]) => `<button class="wz-opt${a.body === k ? ' sel' : ''}" type="button" data-body="${k}" aria-pressed="${a.body === k}">${bodyIcon(k)}<b>${o.label}</b><span>${o.sub}</span></button>`).join('')}</div>`;
    } else if (s === 2) {
      const v = Number(a.budget); canNext = v >= 3 && v <= 500;
      body = `<h2 id="wzTitle" class="display">What's your budget?</h2><p class="muted">Your maximum on-road price in lakhs, for ${esc(RTO.states[state.st].name)}.</p>
        <label class="wz-money"><span>₹</span><input id="wzBudget" inputmode="decimal" autocomplete="off" placeholder="e.g. 12" value="${esc(a.budget)}"><span>lakh</span></label>
        <div class="chips wz-quick">${[6, 8, 10, 12, 15, 20, 25, 35, 50].map((n) => `<button class="chip" type="button" data-budget="${n}" aria-pressed="${Number(a.budget) === n}">₹${n} L</button>`).join('')}</div>
        ${a.budget && !canNext ? '<p class="wz-err">Enter an amount between 3 and 500 lakh.</p>' : ''}`;
    } else if (s === 3) {
      canNext = !!a.fuel;
      const F = { Petrol: 'Simple, widely available', Diesel: 'Torque and long-distance economy', CNG: 'Lowest running cost', Hybrid: 'Petrol + electric, incl. plug-in', Electric: 'Zero tailpipe emissions', Any: 'Show me everything' };
      body = `<h2 id="wzTitle" class="display">Which fuel type?</h2>
        <div class="wz-choices three">${Object.entries(F).map(([k, sub]) => `<button class="wz-opt${a.fuel === k ? ' sel' : ''}" type="button" data-fuel="${k}" aria-pressed="${a.fuel === k}"><b>${k === 'Any' ? 'No preference' : k}</b><span>${sub}</span></button>`).join('')}</div>`;
    } else if (s === 4) {
      canNext = !!a.trans;
      const T = { Automatic: 'Two pedals — AT, CVT, DCT or AMT', Manual: 'Clutch and gear lever', Either: 'Show me both' };
      body = `<h2 id="wzTitle" class="display">Automatic or Manual?</h2>
        <div class="wz-choices three">${Object.entries(T).map(([k, sub]) => `<button class="wz-opt${a.trans === k ? ' sel' : ''}" type="button" data-trans="${k}" aria-pressed="${a.trans === k}"><b>${k === 'Either' ? 'No preference' : k}</b><span>${sub}</span></button>`).join('')}</div>`;
    } else if (s === 5) {
      body = `<h2 id="wzTitle" class="display">What matters most?</h2><p class="muted">Tap one to move it to the top. Most important first.</p>
        <ol class="tt" id="prioList" aria-label="Your priorities, most important first">${ttRows(a.prio)}</ol>`;
    }
    const nav = s ? `<div class="wz-nav"><button class="btn ghost" type="button" data-wz="back">Back</button><button class="btn primary" type="button" data-wz="next" ${canNext ? '' : 'disabled'}>${s === 5 ? 'Show my matches' : 'Next'}</button></div>` : '';
    W.innerHTML = `${close}${dots}<div class="wz-body">${body}</div>${nav}`;
    if (s === 5) wireTT($('#prioList'), () => wz.a.prio, (o) => { wz.a.prio = o; });
    if (s === 2) { const i = $('#wzBudget'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }
  // priorities list: tap a row to move it to the top; rows can also be dragged
  const UP_ICO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 14l6-6 6 6"/></svg>';
  const ttRows = (o) => o.map((k, i) => `<li data-k="${k}" tabindex="0" role="button" aria-label="${PRIO[k]}, number ${i + 1}${i ? '. Move to top' : ''}"><span class="pn">${i + 1}</span><span class="pt"><b>${PRIO[k]}</b><small>${PRIO_HINT[k]}</small></span><span class="tt-up">${i ? UP_ICO + 'Move to top' : 'Most important'}</span></li>`).join('');
  function flipList(L, fn, skip) {
    const before = new Map($$('li', L).map((c) => [c.dataset.k, c.getBoundingClientRect().top]));
    fn();
    for (const c of $$('li', L)) { if (c === skip) continue; const d = (before.get(c.dataset.k) ?? 0) - c.getBoundingClientRect().top; if (d) c.animate([{ transform: `translateY(${d}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' }); }
  }
  function wireTT(L, get, set) {
    if (!L) return;
    const redraw = (o, focusK) => { set(o); flipList(L, () => { L.innerHTML = ttRows(o); }); if (focusK) { const f = $(`li[data-k="${focusK}"]`, L); if (f) f.focus({ preventScroll: true }); } };
    const toTop = (k) => { const o = get().filter((x) => x !== k); o.unshift(k); redraw(o, k); };
    let drag = null, justDragged = false;
    L.addEventListener('click', (e) => { if (justDragged) return; const li = e.target.closest('li'); if (li) toTop(li.dataset.k); });
    L.addEventListener('keydown', (e) => {
      const li = e.target.closest('li'); if (!li) return;
      const o = get().slice(), i = o.indexOf(li.dataset.k);
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toTop(li.dataset.k); }
      else if ((e.key === 'ArrowUp' && i > 0) || (e.key === 'ArrowDown' && i < o.length - 1)) { e.preventDefault(); const j = i + (e.key === 'ArrowUp' ? -1 : 1); [o[i], o[j]] = [o[j], o[i]]; redraw(o, li.dataset.k); }
    });
    L.addEventListener('pointerdown', (e) => { const li = e.target.closest('li'); if (!li) return; drag = { li, y0: e.clientY, moved: false, id: e.pointerId }; li.setPointerCapture(e.pointerId); });
    L.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dy = e.clientY - drag.y0; if (!drag.moved && Math.abs(dy) < 6) return;
      drag.moved = true; drag.li.classList.add('lift'); drag.li.style.transform = `translateY(${dy}px) scale(1.02)`;
      const r = drag.li.getBoundingClientRect(), cy = r.top + r.height / 2, items = $$('li', L).filter((x) => x !== drag.li);
      let idx = items.findIndex((x) => { const q = x.getBoundingClientRect(); return cy < q.top + q.height / 2; }); if (idx < 0) idx = items.length;
      const next = [...items.slice(0, idx).map((x) => x.dataset.k), drag.li.dataset.k, ...items.slice(idx).map((x) => x.dataset.k)];
      if (next.join() !== get().join()) {
        const top0 = r.top - dy; set(next);
        flipList(L, () => { for (const k of next) L.appendChild($(`li[data-k="${k}"]`, L)); }, drag.li);
        drag.li.style.transform = ''; const top1 = drag.li.getBoundingClientRect().top; drag.y0 += top1 - top0; drag.li.style.transform = `translateY(${e.clientY - drag.y0}px) scale(1.02)`;
        $$('li', L).forEach((x, i) => (x.querySelector('.pn').textContent = i + 1));
      }
    });
    const end = () => { if (!drag) return; const d = drag; drag = null; d.li.classList.remove('lift'); d.li.style.transform = ''; if (d.moved) { justDragged = true; setTimeout(() => (justDragged = false), 50); L.innerHTML = ttRows(get()); } };
    L.addEventListener('pointerup', end); L.addEventListener('pointercancel', end);
  }
  function bodyIcon(k) {
    const P = { small: 'M6 30h52M10 30l6-10h22l10 10M16 20v10', sedan: 'M4 30h56M8 30l8-9h26l12 9M20 21l-2 9M36 21v9', suv: 'M4 30h56M6 30V20l6-8h30l10 8 6 2v8M12 12v18M30 12v18' }[k];
    return `<svg class="wz-ico" viewBox="0 0 64 40" aria-hidden="true"><path d="${P}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="18" cy="31" r="4.5" fill="var(--panel)" stroke="currentColor" stroke-width="2.4"/><circle cx="46" cy="31" r="4.5" fill="var(--panel)" stroke="currentColor" stroke-width="2.4"/></svg>`;
  }
  function wireWizard() {
    const W = $('#wizardBody');
    W.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const a = wz.a;
      if (b.dataset.wz === 'close') return closeWizard();
      if (b.dataset.wz === 'browse') { closeWizard(); return; }
      if (b.dataset.wz === 'start') { wz.step = 1; return drawWizard(); }
      if (b.dataset.wz === 'back') { if (wz.step <= 1) return closeWizard(); wz.step = wz.step === 5 && a.fuel === 'Electric' ? 3 : wz.step - 1; return drawWizard(); }
      if (b.dataset.wz === 'next') {
        if (wz.step < 5) { wz.step = wz.step === 3 && a.fuel === 'Electric' ? 5 : wz.step + 1; return drawWizard(); }
        closeWizard();
        const r = { body: a.body, budget: Number(a.budget), fuel: a.fuel || 'Any', trans: a.trans, prio: a.prio.slice() };
        const L = window.RRLoader, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!L) { applyRec(r); return; }
        L.show('Finding your Right Ride…');
        setTimeout(() => applyRec(r), reduce ? 600 : 2200); // results render just before the loader fades out
        setTimeout(() => L.hide(), reduce ? 800 : 2500);
        return;
      }
      if (b.dataset.body) { a.body = b.dataset.body; wz.step = 2; return drawWizard(); }
      if (b.dataset.fuel) { a.fuel = b.dataset.fuel; if (a.fuel === 'Electric') { a.trans = 'Either'; wz.step = 5; } else wz.step = 4; return drawWizard(); }
      if (b.dataset.trans) { a.trans = b.dataset.trans; wz.step = 5; return drawWizard(); }
      if (b.dataset.budget) { a.budget = b.dataset.budget; return drawWizard(); }
    });
    W.addEventListener('input', (e) => {
      if (e.target.id !== 'wzBudget') return;
      wz.a.budget = e.target.value.replace(/[^\d.]/g, '');
      const v = Number(wz.a.budget), ok = v >= 3 && v <= 500;
      $('[data-wz="next"]', W).disabled = !ok;
      $$('.wz-quick .chip', W).forEach((c) => c.setAttribute('aria-pressed', Number(c.dataset.budget) === v));
    });
    W.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'wzBudget') { const n = $('[data-wz="next"]', W); if (!n.disabled) n.click(); } });
    $('#wizard').addEventListener('click', (e) => { if (e.target.id === 'wizard' && wz.step === 0) closeWizard(); });
  }
  function maybeWelcome() {
    let seen = false; try { seen = !!sessionStorage.getItem('rr-welcome'); sessionStorage.setItem('rr-welcome', '1'); } catch (e) {}
    const force = /[?&]intro\b/.test(location.search);
    if ((seen && !force) || (!force && /[?&](body|feats|brand|fuel|min|max)=/.test(location.search))) return;
    const intro = document.getElementById('rr-intro');
    if (intro && !intro.classList.contains('rr-done')) document.addEventListener('rr-intro-done', () => setTimeout(() => openWizard(0), 350), { once: true });
    else openWizard(0);
  }

  // ---------------- state / location ----------------
  const DETECT = '__detect';
  function fillStates(detectedCity) {
    const opts = Object.entries(RTO.states).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('');
    $('#state').innerHTML = `<option value="${DETECT}">${detectedCity ? `◎ Near ${esc(detectedCity)} · detect again` : '◎ Use my current location'}</option><option disabled>──────────</option>` + opts;
    if (!RTO.states[state.st]) state.st = 'DL';
    $('#state').value = state.st;
  }
  function setState(code, manual) {
    state.st = code; store.set('state', code);
    if (manual != null) store.set('stateManual', manual);
    $('#state').value = code; recalc(); render(); if (page === 'car') keepY(() => renderCar(carSlug));
  }
  let locating = false;
  function detect(auto) {
    hideLocToast();
    if (!navigator.geolocation) { if (!auto) locToast('Location isn\'t available in this browser. Please choose your state.', false); return; }
    if (locating) return; locating = true;
    const sel = $('#state'); sel.classList.add('locating'); sel.options[0].textContent = '◎ Finding you…'; sel.value = DETECT;
    navigator.geolocation.getCurrentPosition((p) => {
      locating = false; sel.classList.remove('locating');
      const { latitude: la, longitude: lo } = p.coords;
      let best = null, bd = Infinity;
      for (const [name, st, a, b] of RTO.cities) { const d = (a - la) ** 2 + ((b - lo) * Math.cos(la * Math.PI / 180)) ** 2; if (d < bd) { bd = d; best = [name, st]; } }
      if (best) { store.set('geo', { la, lo, label: best[0] }); fillStates(best[0]); setState(best[1], false); sel.classList.add('located'); setTimeout(() => sel.classList.remove('located'), 1600); }
    }, (err) => {
      locating = false; sel.classList.remove('locating'); fillStates(); $('#state').value = state.st;
      if (auto === true) return; // silent attempt — don't nag
      locToast(err.code === 1 ? 'Allow location access to price cars for your state automatically, or choose your state.' : 'We couldn\'t find your location. Please choose your state.', err.code === 1);
    }, { timeout: 12000, maximumAge: 3600e3 });
  }
  function hideLocToast() { const t = $('#locToast'); if (t) t.hidden = true; }
  function locToast(msg, canRetry) {
    const show = () => {
      const t = $('#locToast');
      t.innerHTML = `<span class="lt-ico" aria-hidden="true">◎</span><span class="lt-msg">${esc(msg)}</span><span class="lt-act">${canRetry ? '<button class="btn ghost" type="button" data-loc="retry">Allow location</button>' : ''}<button class="btn primary" type="button" data-loc="pick">Choose state</button><button class="lt-x" type="button" data-loc="close" aria-label="Dismiss">✕</button></span>`;
      t.hidden = false; clearTimeout(locToast.t); locToast.t = setTimeout(hideLocToast, 15000);
    };
    const w = $('#wizard');
    if (w && w.open) w.addEventListener('close', () => setTimeout(show, 400), { once: true }); else show();
  }
  function autoLocate() {
    if (store.get('stateManual', false)) return; // they picked a state themselves — respect it
    const asked = store.get('locAsked', false);
    const go = () => { store.set('locAsked', true); detect(asked); }; // after the first time, fail quietly
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then((p) => {
        if (p.state === 'granted') detect(true);            // already allowed: no prompt, just locate
        else if (p.state === 'prompt' && !asked) go();       // ask once, ever
        else if (p.state === 'denied' && !asked) { store.set('locAsked', true); locToast('Location access is blocked for this site. Choose your state, or allow location in your browser settings.', false); }
      }).catch(() => { if (!asked) go(); });
    } else if (!asked) go();
  }

  // ---------------- two pages: home (#/) and cars (#/cars) ----------------
  let page = null, carSlug = null, carsY = 0;
  function showPage(next, animate = true, arg = null) {
    if (next === page && (next !== 'car' || arg === carSlug)) return;
    const prev = page; page = next;
    if (prev === 'cars') carsY = window.scrollY;
    const B = document.body, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const swap = () => {
      B.classList.remove('leaving', 'to-cars', 'to-home', 'to-car');
      B.dataset.page = next;
      if (next !== 'car') { document.title = ORIG_TITLE; navFromList = navFromList && next === 'cars'; }
      if (next === 'car') { carSlug = arg; renderCar(arg); window.scrollTo({ top: 0, behavior: 'instant' }); }
      else if (next === 'cars') { render(); window.scrollTo({ top: prev === 'car' ? carsY : 0, behavior: 'instant' }); }
      else { window.scrollTo({ top: 0, behavior: 'instant' }); requestAnimationFrame(placeHorizon); startLanes(); }
      if (animate && prev && !reduce) { void B.offsetWidth; B.classList.add('to-' + next); clearTimeout(showPage.t); showPage.t = setTimeout(() => B.classList.remove('to-cars', 'to-home', 'to-car'), 1100); }
    };
    if (animate && prev && !reduce && window.scrollY < 400 && prev !== 'car' && next !== 'car') { B.classList.add('leaving'); clearTimeout(showPage.l); showPage.l = setTimeout(swap, 330); }
    else swap();
  }
  function go(next, arg) {
    const h = next === 'cars' ? '#/cars' : next === 'car' ? '#/car/' + arg : '#/';
    if (location.hash !== h) location.hash = h; else showPage(next, true, arg);
  }
  function route(animate) {
    const c = location.hash.match(/^#\/car\/([\w-]+)/);
    if (c) return showPage('car', animate, c[1]);
    showPage(/^#\/cars/.test(location.hash) ? 'cars' : 'home', animate);
  }
  // ---------------- home scene: sunrise over a road drawn in true perspective ----------------
  // scene units: 860 tall (always fully visible), width grows with the window; horizon at y=500
  const SC = { VH: 860, HZ: 500, F: 360, B: 0.32, HW: 0.62, ZMIN: 0.92, DL: 0.42, DG: 0.62 };
  const scx = (z) => 680 - SC.F * SC.B + SC.F * SC.B * Math.pow(1 - 1 / z, 2) + SC.F * 0.06 * Math.sin(Math.min(1, 1 / z) * 3.2) * (1 - 1 / z);
  const syz = (z) => SC.HZ + SC.F / z;
  function sband(o1, o2, from, to, n) {
    const pts = (off) => { const o = []; for (let i = 0; i <= n; i++) { const u = 1 / from + (1 / to - 1 / from) * i / n, z = 1 / u; o.push((scx(z) + SC.F * off / z).toFixed(1) + ',' + syz(z).toFixed(1)); } return o; };
    return 'M' + pts(o1).join(' L') + ' L' + pts(o2).reverse().join(' L') + 'Z';
  }
  function drawRoad() {
    const g = $('#road'); if (!g) return;
    const { HW, ZMIN } = SC, far = 400;
    g.innerHTML = `<path class="shoulder" d="${sband(-HW * 1.14, HW * 1.14, ZMIN, far, 140)}"/>
      <path d="${sband(-HW, HW, ZMIN, far, 140)}" fill="url(#asph)"/>
      <path class="grain" d="${sband(-HW, HW, ZMIN, far, 140)}" fill="#fff" filter="url(#grain)"/>
      <path class="edge" d="${sband(-HW + 0.05, -HW + 0.09, ZMIN, far, 140)}"/><path class="edge" d="${sband(HW - 0.09, HW - 0.05, ZMIN, far, 140)}"/>
      <g id="dashes"></g>`;
    drawDashes(0);
  }
  function drawDashes(phase) {
    const g = document.getElementById('dashes'); if (!g) return;
    const { ZMIN, DL, DG } = SC, hw = 0.022; let o = '';
    for (let z = ZMIN - DL - DG + phase; z < 140; z += DL + DG) {
      const z1 = Math.max(z, ZMIN), z2 = z + DL; if (z2 <= ZMIN) continue;
      o += `<path d="${sband(-hw, hw, z1, z2, 8)}"/>`;
    }
    g.innerHTML = o;
  }
  // keep the home buttons exactly on the horizon, and the scene framed so the sun never reaches the headline
  function placeHorizon() {
    const h = $('#hero'), svg = $('#scene'); if (!h || !svg) return;
    const W = h.clientWidth, H = h.clientHeight; if (!W || !H) return;
    const VW = SC.VH * W / H, X0 = (1360 - VW) / 2;
    svg.setAttribute('viewBox', `${X0.toFixed(1)} 0 ${VW.toFixed(1)} ${SC.VH}`);
    h.style.setProperty('--hz', (SC.HZ * H / SC.VH) + 'px');
  }
  let laneRAF = 0, laneT0 = 0;
  function laneLoop(t) {
    if (page !== 'home' || document.hidden) { laneRAF = 0; return; }
    if (!laneT0) laneT0 = t;
    const per = SC.DL + SC.DG, speed = 0.55; // scene units per second, towards the viewer
    drawDashes(per - (((t - laneT0) / 1000 * speed) % per));
    laneRAF = requestAnimationFrame(laneLoop);
  }
  function startLanes() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || laneRAF) return;
    laneRAF = requestAnimationFrame(laneLoop);
  }

  function wirePages() {
    drawRoad(); window.addEventListener('resize', placeHorizon); placeHorizon();
    document.addEventListener('visibilitychange', () => { if (!document.hidden && page === 'home') startLanes(); });
    window.addEventListener('hashchange', () => route(true));
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-go]'); if (!a) return;
      e.preventDefault(); go(a.dataset.go);
    });
    // a shared link with filters, or a saved recommendation, opens straight on the cars page
    if (!location.hash && (state.rec || /[?&](body|feats|brand|fuel|min|max|seats|trans)=/.test(location.search))) history.replaceState(null, '', location.pathname + location.search + '#/cars');
    route(false);
  }

  // ---------------- persistence ----------------
  const SETS = ['body', 'seats', 'brand', 'fuel', 'trans', 'transType', 'drive', 'feats'];
  function saveFilters() {
    const o = { budgetMin: state.budgetMin, budgetMax: state.budgetMax, allowUnknown: state.allowUnknown, closeMatches: state.closeMatches, sort: state.sort };
    for (const k of SETS) o[k] = [...state[k]];
    store.set('filters', o);
    const q = new URLSearchParams();
    for (const k of SETS) if (state[k].size) q.set(k, [...state[k]].join(','));
    if (state.budgetMin) q.set('min', state.budgetMin); if (state.budgetMax) q.set('max', state.budgetMax);
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  }
  function loadFilters() {
    const q = new URLSearchParams(location.search);
    const o = q.toString() ? null : store.get('filters', null);
    for (const k of SETS) { const v = q.get(k) || (o && o[k] && o[k].join(',')); if (v) v.split(',').filter(Boolean).forEach((x) => state[k].add(x)); }
    state.budgetMin = q.get('min') || (o && o.budgetMin) || ''; state.budgetMax = q.get('max') || (o && o.budgetMax) || '';
    if (o) { state.allowUnknown = o.allowUnknown ?? true; state.closeMatches = o.closeMatches ?? true; state.sort = o.sort || 'price'; }
    state.rec = store.get('rec', null);
    if (state.rec && !BODY_OPTS[state.rec.body]) state.rec = null;
    if (state.sort === 'rec' && !state.rec) state.sort = 'price';
    $('#sort option[value="rec"]').hidden = !state.rec;
    $('#sort').value = state.sort;
  }

  // ---------------- wiring ----------------
  function wire() {
    $('#filterBody').addEventListener('click', onFilterClick);
    $('#filterBody').addEventListener('input', (e) => {
      if (e.target.id === 'bmin') state.budgetMin = e.target.value.replace(/[^\d.]/g, '');
      if (e.target.id === 'bmax') state.budgetMax = e.target.value.replace(/[^\d.]/g, '');
      if (e.target.id === 'allowUnknown') state.allowUnknown = e.target.checked;
      if (e.target.id === 'closeMatches') state.closeMatches = e.target.checked;
      state.page = 1; saveFilters(); clearTimeout(wire.t); wire.t = setTimeout(render, 200);
    });
    const onRm = (e) => {
      const b = e.target.closest('[data-rm]'); if (!b) return false;
      if (b.dataset.rm === '*') { clearFilters(); if (state.sort === 'rec') { state.sort = 'price'; $('#sort').value = 'price'; } }
      else { rmFilter(b.dataset.rm); if (!state.q) $('#q').value = ''; }
      state.page = 1; saveFilters(); buildFilters(); render(); return true;
    };
    $('#activeChips').addEventListener('click', onRm);
    $('#list').addEventListener('click', (e) => {
      if (onRm(e)) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      const t = e.target.closest('[data-toggle]');
      if (t) { const k = t.dataset.toggle; state.open.has(k) ? state.open.delete(k) : state.open.add(k); render(); return; }
      const box = e.target.closest('.cmp-box');
      if (box) { box.checked ? (state.compare.size < 4 ? state.compare.add(box.dataset.id) : (box.checked = false)) : state.compare.delete(box.dataset.id); updateCompareBar(); return; }
      const tr = e.target.closest('tr.v'); if (tr) { detail(tr.dataset.id); return; }
      if (e.target.closest('a, button, input, .variants')) return;
      const rc = e.target.closest('.rec-card, .tile'); if (rc) openCar(rc.dataset.key);
    });
    document.addEventListener('click', (e) => {
      const r = e.target.closest('[data-rec]'); if (!r) return;
      if (r.dataset.rec === 'edit') openWizard(1); else { $('#sort option[value="rec"]').hidden = true; setTab('foryou'); }
    });
    $('#findBtn').addEventListener('click', () => openWizard(1));
    document.addEventListener('click', (e) => { if (e.target.closest('[data-open-finder]')) openWizard(1); });
    wireWizard();
    $('#more').addEventListener('click', () => { state.page++; render(); });
    $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; saveFilters(); render(); });
    $('#state').addEventListener('change', (e) => { if (e.target.value === DETECT) { store.set('stateManual', false); detect(false); } else { hideLocToast(); setState(e.target.value, true); } });
    $('#locToast').addEventListener('click', (e) => {
      const b = e.target.closest('[data-loc]'); if (!b) return;
      if (b.dataset.loc === 'retry') { store.set('stateManual', false); detect(false); }
      else if (b.dataset.loc === 'pick') { hideLocToast(); const s = $('#state'); s.focus(); s.classList.add('nudge'); setTimeout(() => s.classList.remove('nudge'), 1200); try { s.showPicker(); } catch (err) {} }
      else hideLocToast();
    });
    $('#reset').addEventListener('click', () => { clearFilters(); if (state.sort === 'rec') { state.sort = 'price'; $('#sort').value = 'price'; } saveFilters(); buildFilters(); render(); });
    $('#compareGo').addEventListener('click', compareView);
    $('#compareClear').addEventListener('click', () => { state.compare.clear(); render(); });
    $('#modal').addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target.id === 'modal') $('#modal').close(); });
    $('#aboutLink').addEventListener('click', (e) => { e.preventDefault(); about(); });
    $('#closeFilters').addEventListener('click', closeDrawer);
    $('#applyMobile').addEventListener('click', () => { closeDrawer(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    $('#list').addEventListener('keydown', (e) => { const t = e.target.closest('.tile'); if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openCar(t.dataset.key); } });
    wireShowroom(); wirePrioBar(); wireCarPage();
  }

  async function init() {
    try {
      const [d, r] = await Promise.all([fetch('data/cars.json').then((x) => x.json()), fetch('data/rto.json').then((x) => x.json())]);
      DATA = d; RTO = r;
    } catch (e) {
      $('#resultTitle').textContent = 'Could not load car data. Please refresh.'; return;
    }
    fillStates(); loadFilters(); state.tab = store.get('tab', null) || (state.rec && state.sort === 'rec' ? 'picks' : 'foryou'); prep(); buildFilters(); wire(); render(); wirePages(); autoLocate();
    $('#heroStats').textContent = `${DATA.cars.length.toLocaleString('en-IN')} variants · ${new Set(DATA.cars.map((c) => c.brand + c.model)).size} models · ${DATA.brands.length} brands — priced for your state`;
    $('#updated').textContent = `Data updated ${new Date(DATA.generated).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · ${DATA.cars.length} variants from ${DATA.brands.length} brands`;
  }
  init();
})();
