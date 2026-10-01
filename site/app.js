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
    for (const k of state.feats) { const v = c.feat(k); if (v === '0') miss.push(k); else if (v === '?') unk.push(k); }
    if (miss.length > (state.closeMatches ? 1 : 0)) return null;
    if (unk.length && !state.allowUnknown) return null;
    return { miss, unk, score: state.feats.size - miss.length - unk.length * 0.5 };
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
    const s = state.sort;
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
    const warn = state.feats.size && m.best ? (m.best.ev.miss.length ? `<span class="tw miss">Missing ${m.best.ev.miss.length}</span>` : m.best.ev.unk.length ? `<span class="tw unk">${m.best.ev.unk.length} unconfirmed</span>` : `<span class="tw ok">All ${state.feats.size} ✓</span>`) : '';
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

  // model sheet: big picture, expert view, video, every variant
  function modelSheet(key) {
    let m = results().find((x) => x.brand + '|' + x.model === key) || groupAll().find((x) => x.brand + '|' + x.model === key);
    if (!m) return;
    const x = expertOf(m);
    const pros = x ? x.like.map((t) => `<li class="pro">${esc(t)}</li>`).join('') + x.dislike.map((t) => `<li class="con">${esc(t)}</li>`).join('') : '';
    $('#modalBody').innerHTML = `<div class="modal-head"><div><div class="brand muted">${esc(m.brand)} · ${esc(m.body)}</div><h2>${esc(m.model)}</h2></div><button class="btn ghost" data-close aria-label="Close">✕</button></div>
      <div class="modal-body sheet">
        <div class="sheet-hero"><div class="sheet-img">${carImg(m, '(max-width: 900px) 92vw, 560px')}</div>
          <div class="sheet-info"><div class="muted small">On-road in ${esc(RTO.states[state.st].name)}</div><div class="sheet-price">${lakh(Math.min(...m.vs.map((v) => v.c.orTotal)))}${m.vs.length > 1 ? ` <span>– ${lakh(Math.max(...m.vs.map((v) => v.c.orTotal)))}</span>` : ''}</div>
            ${x && x.s ? `<div class="xline"><span class="xbadge">Autocar ${esc(x.s)}/10</span>${x.basedOn ? `<span class="muted small"> review of the ${esc(x.basedOn)}</span>` : ''}</div>` : ''}
            ${pros ? `<ul class="pc">${pros}</ul>` : ''}
            <div class="sheet-cta"><a class="btn primary" href="${esc(ytUrl(m))}" target="_blank" rel="noopener">▶ Watch the review</a>${x && x.url ? `<a class="btn ghost" href="${esc(x.url)}" target="_blank" rel="noopener">Expert review ↗</a>` : ''}<a class="btn ghost" href="${esc(m.url)}" target="_blank" rel="noopener">Official site ↗</a></div>
          </div></div>
        <h3 style="margin:22px 0 8px">${m.vs.length} variant${m.vs.length > 1 ? 's' : ''}${state.feats.size || activeCount() ? ' matching your filters' : ''}</h3>
        ${variantTable(m)}
        <p class="hint">Tap a variant for its full price break-up and feature list. Tick up to 4 to compare.</p>
      </div>`;
    if (!$('#modal').open) $('#modal').showModal();
  }

  // natural-language search → filters
  const BRANDS = () => [...new Set(DATA.cars.map((c) => c.brand))];
  function parseQuery(q) {
    let t = ' ' + q.toLowerCase().replace(/₹|rs\.?/g, ' ') + ' ';
    const f = { body: null, fuel: null, trans: null, seats: null, min: null, max: null, brand: null, words: [] };
    const take = (re, fn) => { const m = t.match(re); if (m) { fn(m); t = t.replace(m[0], ' '); } };
    take(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(?:l|lakh|lakhs|lac)?\b/, (m) => { f.min = +m[1]; f.max = +m[2]; });
    take(/(?:under|below|less than|upto|up to|within|<)\s*(\d+(?:\.\d+)?)\s*(?:l|lakh|lakhs|lac)?\b/, (m) => { f.max = +m[1]; });
    take(/(?:above|over|more than|>)\s*(\d+(?:\.\d+)?)\s*(?:l|lakh|lakhs|lac)?\b/, (m) => { f.min = +m[1]; });
    take(/\b(suvs?|crossover)\b/, () => (f.body = 'SUV'));
    take(/\b(hatch|hatchbacks?|small car)\b/, () => (f.body = 'Hatchback'));
    take(/\b(sedans?|saloon)\b/, () => (f.body = 'Sedan'));
    take(/\b(muvs?|mpvs?|people mover)\b/, () => (f.body = 'MUV / MPV'));
    take(/\b(evs?|electric)\b/, () => (f.fuel = 'Electric'));
    take(/\b(diesel)\b/, () => (f.fuel = 'Diesel'));
    take(/\b(petrol)\b/, () => (f.fuel = 'Petrol'));
    take(/\b(cng)\b/, () => (f.fuel = 'CNG'));
    take(/\b(hybrid|phev)\b/, () => (f.fuel = 'Hybrid'));
    take(/\b(automatic|auto|amt|cvt|dct|at)\b/, () => (f.trans = 'Automatic'));
    take(/\b(manual|mt)\b/, () => (f.trans = 'Manual'));
    take(/\b([67])\s*-?\s*seat(?:er|s)?\b/, () => (f.seats = '6–7'));
    take(/\b([45])\s*-?\s*seat(?:er|s)?\b/, () => (f.seats = '4–5'));
    for (const b of BRANDS()) { const bl = b.toLowerCase(), alias = { 'maruti suzuki': 'maruti', 'mercedes-benz': 'mercedes|benz', 'land rover': 'land rover|range rover' }[bl]; const re = new RegExp('\\b(' + bl.replace(/[-]/g, '.') + (alias ? '|' + alias : '') + ')\\b'); if (re.test(t)) { f.brand = b; t = t.replace(re, ' '); break; } }
    f.words = t.replace(/\b(cars?|with|and|for|the|a|an|in|of|me|show|best|good|new|lakhs?|lac|l)\b/g, ' ').split(/\s+/).filter((w) => w.length > 1);
    return f;
  }
  function queryMatch(c) {
    const f = state.qf; if (!f) return true;
    if (f.body && c.body !== f.body) return false;
    if (f.fuel && c.fuel !== f.fuel) return false;
    if (f.trans && c.transmission !== f.trans) return false;
    if (f.seats && seatGroup(c.seats) !== f.seats) return false;
    if (f.brand && c.brand !== f.brand) return false;
    if (f.max && c.orTotal > f.max * L) return false;
    if (f.min && c.orTotal < f.min * L) return false;
    if (f.words.length) { const hay = `${c.brand} ${c.model} ${c.variant}`.toLowerCase(); if (!f.words.every((w) => hay.includes(w))) return false; }
    return true;
  }
  function runSearch(q) {
    state.q = q.trim();
    state.qf = state.q ? parseQuery(state.q) : null;
    if (state.q && state.tab === 'foryou') state.tab = 'all';
    state.page = 1; render();
  }
  function wireShowroom() {
    $('#tabs').addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]'); if (t) return setTab(t.dataset.tab);
      if (e.target.closest('#openFilters')) openDrawer();
    });
    $('#shelves').addEventListener('click', (e) => {
      const s = e.target.closest('[data-see]'); if (s) return seeAll(s.dataset.see);
      const rb = e.target.closest('.rail-btn'); if (rb) { const r = rb.parentElement.querySelector('.rail'); r.scrollBy({ left: (rb.classList.contains('next') ? 1 : -1) * r.clientWidth * 0.85, behavior: 'smooth' }); return; }
      const t = e.target.closest('.tile'); if (t) modelSheet(t.dataset.key);
    });
    $('#shelves').addEventListener('keydown', (e) => { const t = e.target.closest('.tile'); if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); modelSheet(t.dataset.key); } });
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
    $('#resultTitle').textContent = list.length ? `${list.length} model${list.length > 1 ? 's' : ''} · ${nV} variants match` : 'No cars match yet';
    $('#resultSub').textContent = `On-road prices estimated for ${stName}.` + (state.feats.size ? ' Cars with every selected feature are listed first.' : ' Use the filters to narrow down.');
    const act = [];
    for (const k of state.feats) act.push(`<button class="chip" data-rm="feats:${k}">${esc(FLABEL(k))} ✕</button>`);
    for (const n of ['body', 'fuel', 'trans', 'seats', 'brand']) for (const v of state[n]) act.push(`<button class="chip" data-rm="${n}:${esc(v)}">${esc(TTYPES[v] && n === 'transType' ? TTYPES[v] : v)} ✕</button>`);
    if (state.budgetMin || state.budgetMax) act.push(`<button class="chip" data-rm="budget:">₹${state.budgetMin || 0}–${state.budgetMax || '∞'} L ✕</button>`);
    if (state.q) act.unshift(`<button class="chip" data-rm="q:">“${esc(state.q)}” ✕</button>`);
    $('#activeChips').innerHTML = act.join('');
    const shown = list.slice(0, state.page * PAGE);
    recBar();
    document.body.classList.toggle('rec-mode', !!(state.sort === 'rec' && state.rec));
    const recMode = state.sort === 'rec' && state.rec;
    if (recMode && list.length) $('#resultTitle').textContent = `${list.length} model${list.length > 1 ? 's' : ''} ranked for you`;
    if (recMode) $('#resultSub').textContent = `Ranked on your priorities using Autocar India expert scores plus our specs data. Click a car to watch its Autocar India video review.`;
    $('#list').className = recMode ? 'list' : 'tile-grid';
    $('#list').innerHTML = shown.length ? shown.map((m, i) => (recMode ? recCard(m, i + 1) : tile(m))).join('') : `<div class="empty"><h2>Nothing matches every filter</h2><p class="muted">Try raising the budget, removing a feature, or ticking "also show cars missing 1 feature".</p>${state.rec ? '<button class="btn primary" type="button" data-rec="edit">Change my answers</button>' : ''}</div>`;
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
  function recBar() {
    const r = state.rec, bar = $('#recBar');
    if (!r) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.innerHTML = `<div class="rec-sum"><span class="rec-k">Picked for you</span>
      <span class="chip">${esc(BODY_OPTS[r.body].label)}</span><span class="chip">Up to ₹${esc(r.budget)} L on-road</span><span class="chip">${esc(!r.fuel || r.fuel === 'Any' ? 'Any fuel' : r.fuel)}</span><span class="chip">${esc(r.trans === 'Either' ? 'Any gearbox' : r.trans)}</span>
      <span class="rec-prio">${r.prio.map((k, i) => `<b>${i + 1}</b> ${esc(PRIO[k])}`).join('<span class="sep">›</span>')}</span></div>
      <div class="rec-actions"><button class="btn ghost" type="button" data-rec="edit">Edit answers</button><button class="link" type="button" data-rec="exit">Browse all cars</button></div>`;
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
  const wz = { step: 0, a: null };
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
      body = `<h2 id="wzTitle" class="display">What matters most?</h2><p class="muted">Drag to put them in your order — most important at the top.</p>
        <ol class="prio" id="prioList">${a.prio.map((k, i) => `<li class="prio-item" data-k="${k}" tabindex="0"><span class="grip" aria-hidden="true">⋮⋮</span><span class="pn">${i + 1}</span><span class="pt"><b>${PRIO[k]}</b><small>${PRIO_HINT[k]}</small></span><span class="pm"><button type="button" data-move="-1" aria-label="Move ${PRIO[k]} up" ${i ? '' : 'disabled'}>▲</button><button type="button" data-move="1" aria-label="Move ${PRIO[k]} down" ${i < 3 ? '' : 'disabled'}>▼</button></span></li>`).join('')}</ol>`;
    }
    const nav = s ? `<div class="wz-nav"><button class="btn ghost" type="button" data-wz="back">Back</button><button class="btn primary" type="button" data-wz="next" ${canNext ? '' : 'disabled'}>${s === 5 ? 'Show my matches' : 'Next'}</button></div>` : '';
    W.innerHTML = `${close}${dots}<div class="wz-body">${body}</div>${nav}`;
    if (s === 2) { const i = $('#wzBudget'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    if (s === 5) wirePrio();
  }
  function bodyIcon(k) {
    const P = { small: 'M6 30h52M10 30l6-10h22l10 10M16 20v10', sedan: 'M4 30h56M8 30l8-9h26l12 9M20 21l-2 9M36 21v9', suv: 'M4 30h56M6 30V20l6-8h30l10 8 6 2v8M12 12v18M30 12v18' }[k];
    return `<svg class="wz-ico" viewBox="0 0 64 40" aria-hidden="true"><path d="${P}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="18" cy="31" r="4.5" fill="var(--panel)" stroke="currentColor" stroke-width="2.4"/><circle cx="46" cy="31" r="4.5" fill="var(--panel)" stroke="currentColor" stroke-width="2.4"/></svg>`;
  }
  function readPrio() { wz.a.prio = $$('#prioList .prio-item').map((li) => li.dataset.k); }
  function renumber() { $$('#prioList .prio-item').forEach((li, i) => { li.querySelector('.pn').textContent = i + 1; const [u, d] = li.querySelectorAll('[data-move]'); u.disabled = !i; d.disabled = i === 3; }); }
  function wirePrio() {
    const L = $('#prioList');
    let drag = null;
    L.addEventListener('pointerdown', (e) => {
      const li = e.target.closest('.prio-item'); if (!li || e.target.closest('button')) return;
      drag = { li, id: e.pointerId, y0: e.clientY }; li.classList.add('dragging'); li.setPointerCapture(e.pointerId); e.preventDefault();
    });
    L.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const items = $$('.prio-item', L).filter((x) => x !== drag.li);
      const after = items.find((x) => { const r = x.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      after ? L.insertBefore(drag.li, after) : L.appendChild(drag.li);
      renumber();
    });
    const end = () => { if (!drag) return; drag.li.classList.remove('dragging'); drag = null; readPrio(); };
    L.addEventListener('pointerup', end); L.addEventListener('pointercancel', end);
    L.addEventListener('keydown', (e) => {
      const li = e.target.closest('.prio-item'); if (!li || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault(); move(li, e.key === 'ArrowUp' ? -1 : 1); li.focus();
    });
  }
  function move(li, dir) {
    const L = li.parentElement;
    if (dir < 0 && li.previousElementSibling) L.insertBefore(li, li.previousElementSibling);
    if (dir > 0 && li.nextElementSibling) L.insertBefore(li.nextElementSibling, li);
    renumber(); readPrio();
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
      if (b.dataset.move) move(b.closest('.prio-item'), Number(b.dataset.move));
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
    $('#state').value = code; recalc(); render();
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
      if (best) { fillStates(best[0]); setState(best[1], false); sel.classList.add('located'); setTimeout(() => sel.classList.remove('located'), 1600); }
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
  let page = null;
  function showPage(next, animate = true) {
    if (next === page) return;
    const prev = page; page = next;
    const B = document.body, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const swap = () => {
      B.classList.remove('leaving', 'to-cars', 'to-home');
      B.dataset.page = next;
      window.scrollTo({ top: 0, behavior: 'instant' });
      if (next === 'cars') render(); else { requestAnimationFrame(placeHorizon); startLanes(); }
      if (animate && prev && !reduce) { void B.offsetWidth; B.classList.add(next === 'cars' ? 'to-cars' : 'to-home'); clearTimeout(showPage.t); showPage.t = setTimeout(() => B.classList.remove('to-cars', 'to-home'), 1100); }
    };
    if (animate && prev && !reduce && window.scrollY < 400) { B.classList.add('leaving'); clearTimeout(showPage.l); showPage.l = setTimeout(swap, 330); }
    else swap();
  }
  function go(next) {
    const h = next === 'cars' ? '#/cars' : '#/';
    if (location.hash !== h) location.hash = h; else showPage(next);
  }
  function route(animate) { showPage(/^#\/cars/.test(location.hash) ? 'cars' : 'home', animate); }
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
    $('#activeChips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-rm]'); if (!b) return;
      const [k, v] = b.dataset.rm.split(/:(.*)/s);
      if (k === 'budget') { state.budgetMin = state.budgetMax = ''; } else if (k === 'q') { state.q = ''; state.qf = null; $('#q').value = ''; } else state[k].delete(v);
      saveFilters(); buildFilters(); render();
    });
    $('#list').addEventListener('click', (e) => {
      const t = e.target.closest('[data-toggle]');
      if (t) { const k = t.dataset.toggle; state.open.has(k) ? state.open.delete(k) : state.open.add(k); render(); return; }
      const box = e.target.closest('.cmp-box');
      if (box) { box.checked ? (state.compare.size < 4 ? state.compare.add(box.dataset.id) : (box.checked = false)) : state.compare.delete(box.dataset.id); updateCompareBar(); return; }
      const tr = e.target.closest('tr.v'); if (tr) { detail(tr.dataset.id); return; }
      if (e.target.closest('a, button, input, .variants')) return;
      const rc = e.target.closest('.rec-card'); if (rc) { window.open(rc.dataset.yt, '_blank', 'noopener'); return; }
      const tl = e.target.closest('.tile'); if (tl) modelSheet(tl.dataset.key);
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
    $('#list').addEventListener('keydown', (e) => { const t = e.target.closest('.tile'); if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); modelSheet(t.dataset.key); } });
    wireShowroom();
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
