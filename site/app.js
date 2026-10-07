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
    compare: new Set(), open: new Set(), rec: null, tab: 'all', q: '', qf: null,
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
  // brand: a multi-select dropdown, A to Z, with a quick search
  const brandSummary = () => { const b = [...state.brand].sort((x, y) => x.localeCompare(y, 'en', { sensitivity: 'base' })); return !b.length ? 'Any brand' : b.length <= 2 ? b.join(', ') : `${b.length} brands`; };
  function brandPicker(brands) {
    return `<details class="ms" id="brandMs"><summary aria-labelledby="brandLbl brandSum"><span id="brandSum">${esc(brandSummary())}</span><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>
      <div class="ms-pop"><input type="search" class="ms-q" id="brandQ" placeholder="Search brands" aria-label="Search brands" autocomplete="off">
        <div class="ms-list" role="group" aria-label="Brands">${brands.map((b) => `<label class="ms-opt" data-name="${esc(b.toLowerCase())}"><input type="checkbox" data-brand="${esc(b)}" ${state.brand.has(b) ? 'checked' : ''}><span>${esc(b)}</span></label>`).join('')}</div>
        <div class="ms-foot"><button type="button" class="link" data-brandclear>Clear</button><button type="button" class="btn primary sm" data-brandclose>Done</button></div></div></details>`;
  }
  function buildFilters() {
    const bodies = Object.keys(countBy((c) => c.body)).sort();
    const brands = Object.keys(countBy((c) => c.brand)).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
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
        <div class="group"><div class="label" id="brandLbl">Brand</div>${brandPicker(brands)}</div>
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
    if (e.target.closest('[data-brandclose]')) { const d = $('#brandMs'); d.open = false; d.querySelector('summary').focus(); return; }
    if (e.target.closest('[data-brandclear]')) { state.brand.clear(); for (const i of $$('#brandMs [data-brand]')) i.checked = false; $('#brandSum').textContent = brandSummary(); state.page = 1; saveFilters(); render(); return; }
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
  // every model has a picture: maker press image → maker's image → drawn silhouette
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
    { id: 'top', title: 'Top rated by experts', sub: 'The highest expert scores among cars on sale right now', pick: (ms) => ms.filter((m) => m.s).sort(byScore), feature: true, see: { tab: 'top' } },
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
    // car names: "creta", "tata nexon", "scorpio n", "xuv700"-style spellings and small typos
    f.models = [];
    {
      const idx = modelIndex(), toks = t.replace(STOP, ' ').split(/\s+/).filter((x) => x && !/^\d+(\.\d+)?$/.test(x) && !/^(under|below|above|over|seater|seats?|lakhs?|crore|cr|cars?|suv|suvs|sedan|hatchback|muv|diesel|petrol|cng|manual|automatic|auto)$/.test(x));
      for (let i = 0; i < toks.length; i++) {
        for (let n = Math.min(4, toks.length - i); n >= 1; n--) {
          const g = toks.slice(i, i + n).join(''); if (g.length < 2 || (n === 1 && /^(electric|ev|evs|hybrid|mini)$/.test(g))) continue;
          const sc = idx.map((m) => [m, matchName(m, g)]), top = Math.max(0, ...sc.map((x) => x[1])), hits = top ? sc.filter((x) => x[1] === top).map((x) => x[0]) : [];
          if (hits.length) { hits.forEach((m) => f.models.includes(m.key) || f.models.push(m.key)); const re = new RegExp('\\b' + toks.slice(i, i + n).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+') + '\\b'); t = t.replace(re, ' '); i += n - 1; break; }
        }
      }
    }
    const amt = (n, unit) => (/^(cr|crore|crores)$/.test(unit || '') ? +n * 100 : +n);
    const U = '\\s*(l|lakh|lakhs|lac|lacs|cr|crore|crores|k)?\\b';
    take(new RegExp('(\\d+(?:\\.\\d+)?)' + U + '\\s*(?:-|to|and)\\s*(\\d+(?:\\.\\d+)?)' + U), (m) => { f.min = amt(m[1], m[2] || m[4]); f.max = amt(m[3], m[4]); });
    take(new RegExp('(?:under|below|less than|upto|up to|within|max(?:imum)?|<|not more than|cheaper than)\\s*(?:rs\\.?\\s*)?(\\d+(?:\\.\\d+)?)' + U), (m) => { f.max = amt(m[1], m[2]); });
    take(new RegExp('(?:above|over|more than|>|min(?:imum)?|at least|starting)\\s*(?:rs\\.?\\s*)?(\\d+(?:\\.\\d+)?)' + U), (m) => { f.min = amt(m[1], m[2]); });
    take(new RegExp('(?:around|about|approx(?:imately)?|~|near|close to)\\s*(?:rs\\.?\\s*)?(\\d+(?:\\.\\d+)?)' + U), (m) => { const v = amt(m[1], m[2]); f.min = Math.round(v * 0.85 * 10) / 10; f.max = Math.round(v * 1.15 * 10) / 10; });
    take(/\b(\d+(?:\.\d+)?)\s*(l|lakh|lakhs|lac|lacs|cr|crore|crores)\b/, (m) => { f.max = amt(m[1], m[2]); });
    take(/\b(mini|micro|small|compact|sub.?4m?)\s+(suvs?|crossovers?)\b/, () => (f.body = 'SUV'));
    take(/\b(suvs?|crossovers?|compact suvs?)\b/, () => (f.body = 'SUV'));
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
    if (!f.models.length) for (const b of BRANDS()) { const bl = b.toLowerCase(), alias = { 'maruti suzuki': 'maruti suzuki|maruti|suzuki|nexa', 'mercedes-benz': 'mercedes-benz|mercedes benz|mercedes|benz|merc', 'land rover': 'land rover|range rover|landrover', volkswagen: 'volkswagen|vw', 'mg': 'mg|morris garages', 'citroën': 'citroën|citroen|citreon', 'force motors': 'force motors|force', 'mini': 'mini cooper|mini countryman|mini brand', bmw: 'bmw|beemer' }[bl]; const re = new RegExp('\\b(' + (alias || bl.replace(/[-]/g, '.')) + ')\\b'); if (re.test(t)) { f.brand = b; t = t.replace(re, ' '); break; } }
    // anything left must match a model/variant name; words that match no car at all are ignored (and shown as ignored)
    const hayAll = DATA.cars.map((c) => `${c.brand} ${c.model} ${c.variant}`.toLowerCase());
    for (const w of t.replace(STOP, ' ').split(/\s+/).filter((w) => w.length > 1)) {
      const w2 = w.replace(/s$/, '');
      if (hayAll.some((h) => h.includes(w))) f.words.push(w); else if (w2.length > 1 && hayAll.some((h) => h.includes(w2))) f.words.push(w2); else f.ignored.push(w);
    }
    return f;
  }
  // model name index for search and suggestions
  let MIDX = null;
  const compact = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function modelIndex() {
    if (MIDX) return MIDX;
    const g = new Map();
    for (const c of DATA.cars) { const k = c.brand + '|' + c.model; if (!g.has(k)) g.set(k, { key: k, brand: c.brand, model: c.model, body: c.body, image: c.image, min: Infinity }); const m = g.get(k); m.min = Math.min(m.min, c.price); }
    MIDX = [...g.values()].map((m) => { const w = m.model.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); return { ...m, c: compact(m.model), bc: compact(m.brand) + compact(m.model), suf: w.map((_, i) => w.slice(i).join('')), w0: w[0] }; });
    return MIDX;
  }
  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) { const cur = [i]; let best = i; for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); best = Math.min(best, cur[j]); } if (best > max) return max + 1; prev = cur; }
    return prev[b.length];
  }
  // does the typed text g (letters/digits only) name this model? exact, family prefix ("thar" → Thar OG, Thar Roxx), tail ("evoque"), brand+model, or a small typo
  // how well does typed text g (letters/digits only) name this model? 3 exact/brand+model/tail, 2 family prefix ("thar" → Thar OG, Thar Roxx), 1 small typo
  function matchName(m, g) {
    if (m.c === g || m.bc === g || m.suf.includes(g)) return 3;
    if (g.length >= 3 && (m.c.startsWith(g) || m.bc.startsWith(g) && g.length > compact(m.brand).length + 1)) return 2;
    if (g.length >= 5) { const tol = g.length >= 8 ? 2 : 1; if (lev(g, m.c, tol) <= tol || (m.w0.length >= 5 && lev(g, m.w0, tol) <= tol)) return 1; }
    return 0;
  }
  // what the search understood, as removable chips
  function queryParts(f) {
    if (!f) return [];
    const p = [];
    if (f.brand) p.push(['brand', f.brand]);
    if (f.models && f.models.length) p.push(['models', f.models.map((k) => k.split('|')[1]).join(', ')]);
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
    const g = { ...f, feats: f.feats.slice(), words: f.words.slice(), models: (f.models || []).slice() };
    if (part.startsWith('feat:')) g.feats = g.feats.filter((k) => k !== part.slice(5));
    else if (part === 'budget') g.min = g.max = null;
    else if (part === 'words') g.words = [];
    else if (part === 'models') g.models = [];
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
    if (f.models && f.models.length && !f.models.includes(c.brand + '|' + c.model)) return false;
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
  // car-name suggestions under the search box
  const sug = { i: -1 };
  function suggest(q) {
    const g = compact(q); if (g.length < 2) return [];
    const idx = modelIndex(), sc = [];
    for (const m of idx) {
      let v = 0;
      if (m.c === g || m.bc === g) v = 100;
      else if (m.c.startsWith(g) || m.bc.startsWith(g)) v = 80 - (m.c.length - g.length) * 0.5;
      else if (m.suf.some((x) => x.startsWith(g))) v = 60;
      else if (g.length >= 3 && (m.c.includes(g) || m.bc.includes(g))) v = 40;
      else if (g.length >= 4) { const d = Math.min(lev(g, m.c.slice(0, g.length + 1), 2), lev(g, m.c, 2)); if (d <= (g.length >= 7 ? 2 : 1)) v = 30 - d * 5; }
      if (!v) { // the last word or two of a longer query ("show me creta")
        const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
        for (const n of [2, 1]) { const tail = compact(toks.slice(-n).join('')); if (tail.length >= 3 && (m.c.startsWith(tail) || m.suf.includes(tail))) { v = 25; break; } }
      }
      if (v) sc.push([v, m]);
    }
    return sc.sort((a, b) => b[0] - a[0] || a[1].min - b[1].min).slice(0, 6).map((x) => x[1]);
  }
  function drawSug(q) {
    const box = $('#qSug'), list = suggest(q || '');
    sug.i = -1;
    if (!list.length) return hideSug();
    const orMin = (k) => Math.min(...DATA.cars.filter((c) => c.brand + '|' + c.model === k).map((c) => c.orTotal));
    box.innerHTML = list.map((m, i) => `<div class="sug" role="option" id="sug${i}" data-sug="${esc(m.key)}" aria-selected="false"><span class="sug-img">${carImg(m, '72px')}</span><span class="sug-t"><b>${esc(m.model)}</b><small>${esc(m.brand)} · ${esc(m.body)}</small></span><span class="sug-p">from ${lakh(orMin(m.key))}</span></div>`).join('') + `<div class="sug-foot">Press Enter to search for “${esc(q.trim())}”</div>`;
    box.hidden = false; $('#q').setAttribute('aria-expanded', 'true');
  }
  function hideSug() { const box = $('#qSug'); if (box) box.hidden = true; const q = $('#q'); if (q) { q.setAttribute('aria-expanded', 'false'); q.removeAttribute('aria-activedescendant'); } sug.i = -1; }
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
    let qt; $('#q').addEventListener('input', (e) => { clearTimeout(qt); drawSug(e.target.value); qt = setTimeout(() => runSearch(e.target.value), 250); });
    $('#q').addEventListener('keydown', (e) => {
      const box = $('#qSug'), rows = $$('[data-sug]', box), open = !box.hidden && rows.length;
      if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); const n = rows.length; sug.i = e.key === 'ArrowDown' ? (sug.i + 1 > n - 1 ? -1 : sug.i + 1) : (sug.i - 1 < -1 ? n - 1 : sug.i - 1); rows.forEach((r, i) => r.setAttribute('aria-selected', i === sug.i)); if (sug.i >= 0) e.target.setAttribute('aria-activedescendant', rows[sug.i].id); return; }
      if (e.key === 'Escape') { hideSug(); return; }
      if (e.key === 'Enter') { clearTimeout(qt); if (open && sug.i >= 0) { const k = rows[sug.i].dataset.sug; hideSug(); e.target.blur(); openCar(k); return; } hideSug(); runSearch(e.target.value); e.target.blur(); }
    });
    $('#q').addEventListener('focus', (e) => drawSug(e.target.value));
    $('#q').addEventListener('blur', () => setTimeout(hideSug, 150));
    $('#qSug').addEventListener('mousedown', (e) => { const r = e.target.closest('[data-sug]'); if (!r) return; e.preventDefault(); hideSug(); $('#q').blur(); openCar(r.dataset.sug); });
    $('#scrim').addEventListener('click', closeDrawer);
    $('#modal').addEventListener('click', (e) => {
      const box = e.target.closest('.cmp-box');
      if (box) { cmpToggle(box.dataset.id, box.checked); return; }
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
    $('#resultSub').textContent = state.qf && state.qf.ignored.length ? `Ignored: ${state.qf.ignored.join(', ')}.` : '';
    $('#activeChips').innerHTML = activeFilters().map(([spec, label]) => `<button class="chip" data-rm="${esc(spec)}">${esc(label)} ✕</button>`).join('');
    const shown = list.slice(0, state.page * PAGE);
    recBar();
    document.body.classList.toggle('rec-mode', !!(state.sort === 'rec' && state.rec));
    const recMode = state.sort === 'rec' && state.rec;
    if (recMode && list.length) $('#resultTitle').textContent = `${list.length} model${list.length > 1 ? 's' : ''} ranked for you`;
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
      expertOf(m) && expertOf(m).s ? `<span class="tag xtag" title="Expert score">Expert ${esc(expertOf(m).s)}/10</span>` : '',
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
        <td><input type="checkbox" class="cmp-box" data-id="${esc(c.id)}" ${cmpKeys().includes(c.brand + '|' + c.model) ? 'checked' : ''} aria-label="Compare this car"></td>
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


  function about() {
    const rows = DATA.brands.sort((a, b) => a.brand.localeCompare(b.brand)).map((b) => `<tr><td>${esc(b.brand)}</td><td class="num">${b.models}</td><td class="num">${b.variants}</td><td>${b.curated ? 'Curated snapshot' : 'Official site (automatic)'}</td><td>${b.updated ? new Date(b.updated).toLocaleDateString('en-IN') : ''}</td></tr>`).join('');
    $('#modalBody').innerHTML = `<div class="modal-head"><h2>Data sources &amp; coverage</h2><button class="btn ghost" data-close aria-label="Close">✕</button></div><div class="modal-body">
      <p>Every Monday a robot visits each carmaker's official Indian website and collects models, variants, ex-showroom prices and (where published) variant-wise features. Where a maker publishes state-wise prices (Hyundai, Maruti Suzuki, Toyota, Honda) those are used; otherwise the national/Delhi ex-showroom price is used.</p>
      <p>Expert scores, real-world mileage, owner ratings, service costs and some missing feature details come from leading Indian motoring publications and car sites, and are refreshed weekly. Crash-test results come from Bharat NCAP, Global NCAP and, where neither has tested a car, ASEAN NCAP. Resale values and some maintenance costs are our own estimates and are labelled as such.</p>
      <p>Car photos are the manufacturers' own press and website images. Showroom locations © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> (<a href="https://opendatacommons.org/licenses/odbl/" target="_blank" rel="noopener">ODbL</a>); our showroom list (<a href="data/dealers.json">dealers.json</a>) is offered under the same licence.</p>
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

  const NCAP_INFO = {
    'Global NCAP': '<b>Global NCAP</b> is an independent crash-test programme, run by a UK-based charity, that buys cars sold in India and crash-tests them under its "Safer Cars for India" campaign. Cars get separate star ratings for adult and child protection. Since 2022 its tests are stricter: they add a side impact and need electronic stability control (ESC) for top marks. Adult protection is scored out of 34 and child protection out of 49.',
    'Bharat NCAP': '<b>Bharat NCAP</b> is India\'s own crash-test programme, run by the Ministry of Road Transport and Highways since late 2023. It crash-tests cars from the front, the side and against a pole, and gives star ratings for adult and child protection. Adult protection is scored out of 32 and child protection out of 49.',
  };
  NCAP_INFO['ASEAN NCAP'] = '<b>ASEAN NCAP</b> is the crash-test programme for Southeast Asia (Malaysia, Thailand, Indonesia and neighbours), run from Malaysia. We show its rating only when a car has no Bharat NCAP or Global NCAP result, so the car tested is the Southeast Asian version, which can differ from the Indian one in airbags and other kit. Since 2021 it scores adult protection out of 40, child protection out of 20 and safety assist systems out of 20; older tests used different rules.';
  const ncapInfo = (by) => `<div class="nc-info" id="ncInfo" hidden><p>${NCAP_INFO[by] || ''}</p><p class="muted small">More stars means better protection in a crash. Ratings apply to the version that was tested; newer or facelifted versions may differ.</p></div>`;
  function renderCar(slug) {
    const el = $('#carPage'), m = modelBySlug(slug);
    if (!m) { el.innerHTML = `<div class="cp-wrap"><div class="empty sorry">${SORRY_ICON}<h2>Sorry, we couldn't find that car</h2><p class="muted">It may have been discontinued or renamed.</p><a class="btn primary" href="#/cars" data-go="cars">Browse all cars</a></div></div>`; return; }
    const key = m.brand + '|' + m.model;
    if (cp.key !== key) {
      gal.i = 0; cp.key = key; cp.fuel.clear(); cp.gear.clear(); cp.need.clear(); cp.all = false; cp.more = false;
      // carry over what was chosen on the cars page (filters, search, finder answers) where this model offers it
      const vs = m.vs.map((v) => v.c), q = state.qf || {};
      const fuels = new Set([...state.fuel, q.fuel].filter(Boolean)), gears = new Set([...state.trans, q.trans].filter(Boolean));
      for (const f of fuels) if (vs.some((c) => c.fuel === f)) cp.fuel.add(f);
      for (const g of gears) if (vs.some((c) => c.transmission === g)) cp.gear.add(g);
      for (const k of featsOn()) if (vs.some((c) => c.feat(k) === '1')) cp.need.add(k);
      cp.carried = cp.fuel.size + cp.gear.size + cp.need.size; cp.carriedFrom = 'search';
      // coming from the compare page: its must-haves and nice-to-haves replace the above
      if (cp.fromCmp) {
        cp.fromCmp = false; cp.fuel.clear(); cp.gear.clear(); cp.need.clear();
        const FUEL_REQ = { ev: 'Electric', diesel: 'Diesel', cng: 'CNG' };
        const apply = (k) => {
          if (k === 'auto') { if (vs.some((c) => c.transmission === 'Automatic')) cp.gear.add('Automatic'); return; }
          if (FUEL_REQ[k]) { if (vs.some((c) => c.fuel === FUEL_REQ[k])) cp.fuel.add(FUEL_REQ[k]); return; }
          if (k === 'hybrid') { vs.filter((c) => /hybrid/i.test(c.fuel)).forEach((c) => cp.fuel.add(c.fuel)); return; }
          if (FIDX[k] != null && vs.some((c) => c.feat(k) === '1')) cp.need.add(k);
        };
        const fits = () => vs.some((c) => (!cp.fuel.size || cp.fuel.has(c.fuel)) && (!cp.gear.size || cp.gear.has(c.transmission)) && [...cp.need].every((k) => c.feat(k) === '1'));
        cmp.req.must.forEach(apply);
        // a nice-to-have is ticked only if some variant still has every must-have along with it
        for (const k of cmp.req.nice) {
          const before = { f: new Set(cp.fuel), g: new Set(cp.gear), n: new Set(cp.need) };
          apply(k);
          if (!fits()) { cp.fuel = before.f; cp.gear = before.g; cp.need = before.n; }
        }
        cp.carried = cp.fuel.size + cp.gear.size + cp.need.size; cp.carriedFrom = 'compare';
      }
    }
    const x = expertOf(m), nc = (DATA.ncap || {})[key], usp = (DATA.usp || {})[key];
    const st = RTO.states[state.st].name;
    document.title = `${m.brand} ${m.model}: on-road price in ${st}, variants & showrooms · Right Ride`;
    const seats = [...new Set(m.vs.map((v) => v.c.seats).filter(Boolean))].sort();
    const tags = [...m.fuels, ...m.trans, seats.length ? seats.join(' / ') + ' seats' : '', `${m.vs.length} variant${m.vs.length > 1 ? 's' : ''}`].filter(Boolean);
    const max = (nc && nc.max) || { 'Bharat NCAP': [32, 49], 'Global NCAP': [34, 49] }[nc && nc.by] || [null, null];
    const safety = nc ? `<div class="nc-top">${stars(nc.stars)}<div><b>${nc.stars}-star</b> ${nc.by === 'ASEAN NCAP' ? 'overall safety' : 'adult safety'}<div class="muted small nc-by">${esc(nc.by)}${nc.year ? ` · ${nc.year}` : ''}<button type="button" class="info-btn" data-ncinfo aria-expanded="false" aria-controls="ncInfo" aria-label="What is ${esc(nc.by)}?">i</button></div></div></div>${ncapInfo(nc.by)}
        ${nc.aop != null || nc.cop != null ? `<div class="nc-bars">${nc.aop != null ? `<div><span>Adult occupant</span>${bar10(nc.aop / max[0] * 10)}<b>${nc.aop}${max[0] ? `<small>/${max[0]}</small>` : ''}</b></div>` : ''}${nc.cop != null ? `<div><span>Child occupant</span>${bar10(nc.cop / max[1] * 10)}<b>${nc.cop}${max[1] ? `<small>/${max[1]}</small>` : ''}</b></div>` : ''}${nc.sa != null ? `<div><span>Safety assist</span>${bar10(nc.sa / max[2] * 10)}<b>${nc.sa}${max[2] ? `<small>/${max[2]}</small>` : ''}</b></div>` : ''}</div>` : ''}
        ${nc.note ? `<p class="note">${esc(nc.note)}</p>` : ''}`
      : `<p class="muted">Not crash-tested by Bharat NCAP or Global NCAP yet. ${m.vs.some((v) => v.c.airbags) ? `Comes with up to ${Math.max(...m.vs.map((v) => v.c.airbags || 0))} airbags.` : ''}</p>`;
    const usp1 = usp && usp.length ? `<section class="cp-sec cp-usp"><div class="cp-sec-head"><h3 class="display">Why people pick it</h3><span class="ai-tag"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2l1.8 5.6L19.5 9l-5.7 1.6L12 16l-1.8-5.4L4.5 9l5.7-1.4zM19 15l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9z"/></svg>AI summary of expert reviews</span></div>
        <ol class="usp">${usp.map((u) => `<li>${esc(u)}</li>`).join('')}</ol></section>` : '';
    const chHead = (n, id, title, sub) => `<header class="ch-head"><span class="ch-n" aria-hidden="true">${n}</span><div><h2 class="ch-t" id="${id}T">${title}</h2>${sub ? `<p class="muted">${sub}</p>` : ''}</div></header>`;
    $('#carPage').innerHTML = `<div class="cp-wrap">
      <button class="cp-back" type="button" data-back><span aria-hidden="true">‹</span> All cars</button>
      <section class="cp-hero">
        <div class="cp-media"><div class="cp-img" id="heroGal">${carImg(m, '(max-width: 900px) 92vw, 640px')}</div><div class="hg-strip" id="heroStrip"></div></div>
        <div class="cp-info">
          <div class="cp-eyebrow">${esc(m.brand)} · ${esc(m.body)}</div>
          <h1 class="display cp-title">${esc(m.model)}</h1>
          <div class="muted small">On-road price in ${esc(st)}</div>
          <div class="cp-price">${lakh(m.min)}${m.max > m.min ? ` <span>– ${lakh(m.max)}</span>` : ''}</div>
          <div class="cp-tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
          <div class="cp-badges">${x && x.s ? `<span class="cp-badge"><b>${esc(x.s)}</b><small>/10</small><span>Expert score</span></span>` : ''}${nc ? `<a class="cp-badge nc" href="#cpSafety" data-jump="cpSafety"><b>${nc.stars}★</b><span>${esc(nc.by)}</span></a>` : ''}</div>
          <div class="sheet-cta"><a class="btn primary" href="#chVariant" data-jump="chVariant">Find the Right Variant</a><a class="btn ghost" href="#chDealer" data-jump="chDealer">Find the Right Dealer</a></div>
        </div>
      </section>
      <nav class="cp-nav" id="cpNav" aria-label="Sections"><a href="#chRide" data-jump="chRide" class="on"><span class="n">1</span><b>Is this my Right Ride?</b></a><a href="#chVariant" data-jump="chVariant"><span class="n">2</span><b>Find the Right Variant</b></a><a href="#chDealer" data-jump="chDealer"><span class="n">3</span><b>Find the Right Dealer</b></a></nav>
      <section class="cp-ch" id="chRide" aria-labelledby="chRideT">
        ${chHead(1, 'chRide', 'Is this my Right Ride?', `What owning a ${esc(m.model)} is like, what experts think and how safe it is.`)}
        <section class="cp-sec" id="cpMetrics" hidden></section>
        ${usp1}
        <div class="cp-two">
          <section class="cp-sec" id="cpSafety"><div class="cp-sec-head"><h3 class="display">Safety rating</h3></div>${safety}</section>
          <section class="cp-sec"><div class="cp-sec-head"><h3 class="display">Expert view</h3>${x && x.s ? `<span class="xbadge">Expert score ${esc(x.s)}/10</span>` : ''}</div>
            ${x ? `<ul class="pc">${x.like.map((t) => `<li class="pro">${esc(t)}</li>`).join('')}${x.dislike.map((t) => `<li class="con">${esc(t)}</li>`).join('')}</ul>${x.basedOn ? `<p class="muted small">From the review of the ${esc(x.basedOn)}.</p>` : ''}` : '<p class="muted">No expert review yet.</p>'}
            <div class="cp-links"><a class="watch" href="${esc(ytUrl(m))}" target="_blank" rel="noopener"${trk(m, 'video', ytCh(m))}><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21.6 7.2a2.7 2.7 0 0 0-1.9-1.9C18 4.8 12 4.8 12 4.8s-6 0-7.7.5A2.7 2.7 0 0 0 2.4 7.2 28 28 0 0 0 2 12a28 28 0 0 0 .4 4.8 2.7 2.7 0 0 0 1.9 1.9c1.7.5 7.7.5 7.7.5s6 0 7.7-.5a2.7 2.7 0 0 0 1.9-1.9A28 28 0 0 0 22 12a28 28 0 0 0-.4-4.8zM10 15.1V8.9l5.2 3.1z"/></svg>Watch the video review</a>${x && x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener"${trk(m, 'review', 'Autocar India')}>Read the review ↗</a>` : ''}<a href="${esc(m.url)}" target="_blank" rel="noopener"${trk(m, 'maker-site', m.brand)}>Official site ↗</a></div>
          </section>
        </div>
      </section>
      <section class="cp-ch" id="chVariant" aria-labelledby="chVariantT">
        ${chHead(2, 'chVariant', 'Find the Right Variant', `${m.vs.length} variant${m.vs.length > 1 ? 's' : ''}. Choose on the left; the variant that fits shows on the right.`)}
        <div class="cp-sec" id="cpVariants"></div>
      </section>
      <section class="cp-ch" id="chDealer" aria-labelledby="chDealerT">
        ${chHead(3, 'chDealer', 'Find the Right Dealer', `${esc(m.brand)} showrooms near you, nearest first. Book a test drive in a tap.`)}
        <div class="cp-sec" id="cpDealers"></div>
      </section>
    </div>`;
    drawVariants(m); drawDealers(m); spyChapters();
    loadExtras().then((X) => { if (cp.key !== key) return; const e = X[key]; if (e) { drawHeroGallery(m, e); drawMetrics(m, e); } });
  }

  // ---- photos (colours, interior) and ownership metrics, from site/data/extras.json ----
  let EXTRAS = null;
  const loadExtras = () => EXTRAS || (EXTRAS = fetch('data/extras.json').then((r) => (r.ok ? r.json() : { models: {} })).then((d) => d.models || {}).catch(() => ({})));
  const pic = (u, w) => encodeURI(u.split('?')[0]) + (/autocarindia\.com/.test(u) ? `?w=${w}` : '');
  // hero photo carousel: studio shot, every colour, then the cabin; tap to open full screen
  const gal = { i: 0, slides: [] };
  function heroSlides(m, e) {
    const out = [];
    if (m.image) out.push({ img: m.image, cap: `${m.brand} ${m.model}`, kind: 'main' });
    for (const c of e.colors) out.push({ img: c.img, cap: c.name, kind: 'color', sw: c.sw });
    for (const c of e.interior) out.push({ img: c.img, cap: c.cap, kind: 'interior' });
    return out;
  }
  const swStyle = (sw) => (sw.length > 1 ? `linear-gradient(135deg, ${sw[0]} 50%, ${sw[1]} 50%)` : sw[0]);
  function slideImg(m, x, i, w, sizes) {
    return `<img loading="${i < 2 ? 'eager' : 'lazy'}" decoding="async" src="${esc(pic(x.img, w))}" srcset="${esc(pic(x.img, 640))} 640w, ${esc(pic(x.img, 1000))} 1000w, ${esc(pic(x.img, 1600))} 1600w" sizes="${sizes}" alt="${esc(m.brand + ' ' + m.model + ' – ' + x.cap)}" onerror="this.closest('[data-slide]').classList.add('broken')">`;
  }
  function drawHeroGallery(m, e) {
    const H = $('#heroGal'), S = $('#heroStrip'); if (!H || !S) return;
    gal.slides = heroSlides(m, e); gal.i = 0; gal.m = m;
    if (gal.slides.length < 2) return;
    const firstColor = gal.slides.findIndex((x) => x.kind === 'color'), firstInt = gal.slides.findIndex((x) => x.kind === 'interior');
    H.classList.add('hg');
    H.innerHTML = `<div class="hg-track" id="hgTrack" tabindex="0" aria-label="Photos of the ${esc(m.model)}">${gal.slides.map((x, i) => `<button type="button" class="hg-slide ${x.kind}" data-slide data-open="${i}" aria-label="Open photo ${i + 1} of ${gal.slides.length}: ${esc(x.cap)}">${x.kind === 'main' ? carImg(m, '(max-width: 900px) 92vw, 640px') : slideImg(m, x, i, 1000, '(max-width: 900px) 92vw, 680px')}</button>`).join('')}</div>
      <button class="gal-btn prev" type="button" data-hs="-1" aria-label="Previous photo">‹</button><button class="gal-btn next" type="button" data-hs="1" aria-label="Next photo">›</button>
      <div class="hg-cap" id="hgCap" aria-live="polite"></div><span class="hg-zoom" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></span>`;
    S.innerHTML = `${firstColor >= 0 ? `<div class="hg-sws" role="group" aria-label="Colours">${gal.slides.map((x, i) => x.kind === 'color' ? `<button type="button" class="sw" data-hi="${i}" title="${esc(x.cap)}" aria-label="${esc(x.cap)}"><span style="background:${swStyle(x.sw)}"></span></button>` : '').join('')}</div>` : ''}
      ${firstInt >= 0 ? `<button type="button" class="hg-int" data-hi="${firstInt}"><img src="${esc(pic(gal.slides[firstInt].img, 160))}" alt="" loading="lazy"><span>Interior<em>${gal.slides.filter((x) => x.kind === 'interior').length} photos</em></span></button>` : ''}`;
    const T = $('#hgTrack');
    const sync = () => {
      gal.i = Math.max(0, Math.min(gal.slides.length - 1, Math.round(T.scrollLeft / (T.clientWidth || 1)) || 0));
      const x = gal.slides[gal.i];
      $('#hgCap').textContent = `${x.kind === 'interior' ? 'Interior · ' : ''}${x.cap}  ·  ${gal.i + 1}/${gal.slides.length}`;
      $$('[data-hi]', S).forEach((b) => b.setAttribute('aria-current', Number(b.dataset.hi) === gal.i || (b.classList.contains('hg-int') && x.kind === 'interior')));
      $('.gal-btn.prev', H).disabled = gal.i === 0; $('.gal-btn.next', H).disabled = gal.i === gal.slides.length - 1;
    };
    let raf; T.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(sync); }, { passive: true });
    T.addEventListener('keydown', (ev) => { if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') { ev.preventDefault(); heroGo(gal.i + (ev.key === 'ArrowRight' ? 1 : -1)); } });
    sync();
  }
  function heroGo(i, smooth = true) { const T = $('#hgTrack'); if (!T) return; i = Math.max(0, Math.min(gal.slides.length - 1, i)); T.scrollTo({ left: i * T.clientWidth, behavior: smooth ? 'smooth' : 'instant' }); }
  // full-screen viewer
  function openLightbox(start) {
    let L = $('#lightbox');
    if (!L) { L = document.createElement('dialog'); L.id = 'lightbox'; L.className = 'lb'; document.body.appendChild(L); wireLightbox(L); }
    const m = gal.m, n = gal.slides.length;
    L.innerHTML = `<div class="lb-top"><div class="lb-title"><b>${esc(m.brand)} ${esc(m.model)}</b><span id="lbCap"></span></div><button type="button" class="lb-x" data-lbx aria-label="Close">✕</button></div>
      <div class="lb-stage"><div class="lb-track" id="lbTrack" tabindex="0">${gal.slides.map((x, i) => `<figure class="lb-slide" data-slide>${x.kind === 'main' ? carImg(m, '100vw') : slideImg(m, x, Math.abs(i - start) < 2 ? 0 : 9, 1600, '100vw')}</figure>`).join('')}</div>
        <button class="gal-btn prev lb-btn" type="button" data-lbs="-1" aria-label="Previous photo">‹</button><button class="gal-btn next lb-btn" type="button" data-lbs="1" aria-label="Next photo">›</button></div>
      <div class="lb-thumbs" id="lbThumbs">${gal.slides.map((x, i) => `<button type="button" class="lb-th${x.kind === 'color' ? ' c' : ''}" data-lbi="${i}" aria-label="${esc(x.cap)}">${x.kind === 'main' ? carImg(m, '96px') : `<img src="${esc(pic(x.img, 200))}" alt="" loading="lazy">`}${x.kind === 'color' ? `<i style="background:${swStyle(x.sw)}"></i>` : ''}</button>`).join('')}</div>`;
    if (!L.open) L.showModal();
    document.body.classList.add('lb-open');
    const T = $('#lbTrack');
    requestAnimationFrame(() => { T.scrollLeft = start * T.clientWidth; lbSync(); });
    T.addEventListener('scroll', () => { cancelAnimationFrame(lbSync.r); lbSync.r = requestAnimationFrame(lbSync); }, { passive: true });
    T.focus({ preventScroll: true });
  }
  function lbSync() {
    const T = $('#lbTrack'); if (!T) return;
    const i = Math.max(0, Math.min(gal.slides.length - 1, Math.round(T.scrollLeft / (T.clientWidth || 1)) || 0)), x = gal.slides[i]; if (!x) return;
    $('#lbCap').textContent = `${x.kind === 'interior' ? 'Interior · ' : x.kind === 'color' ? 'Colour · ' : ''}${x.cap}  ·  ${i + 1} of ${gal.slides.length}`;
    $$('[data-lbi]').forEach((b) => b.setAttribute('aria-current', Number(b.dataset.lbi) === i));
    const th = $(`[data-lbi="${i}"]`); if (th) th.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    $('.lb-btn.prev').disabled = i === 0; $('.lb-btn.next').disabled = i === gal.slides.length - 1;
    lbSync.i = i;
  }
  function lbGo(i) { const T = $('#lbTrack'); if (!T) return; i = Math.max(0, Math.min(gal.slides.length - 1, i)); T.scrollTo({ left: i * T.clientWidth, behavior: 'smooth' }); }
  function wireLightbox(L) {
    L.addEventListener('click', (e) => {
      if (e.target.closest('[data-lbx]')) return L.close();
      const s = e.target.closest('[data-lbs]'); if (s) return lbGo((lbSync.i || 0) + Number(s.dataset.lbs));
      const t = e.target.closest('[data-lbi]'); if (t) return lbGo(Number(t.dataset.lbi));
      if (e.target.classList.contains('lb-slide') || e.target.classList.contains('lb-stage')) L.close(); // tap outside the photo
    });
    L.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); lbGo((lbSync.i || 0) + (e.key === 'ArrowRight' ? 1 : -1)); } });
    L.addEventListener('close', () => { document.body.classList.remove('lb-open'); heroGo(lbSync.i || 0, false); });
  }
  const fmtL = (n) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : `₹${(n / 1e5).toFixed(1)} L`);
  function drawMetrics(m, e) {
    const box = $('#cpMetrics'); if (!box) return;
    const tiles = [];
    // maintenance
    if (e.service) {
      const s = e.service, yr = (v) => Math.round(v / 5 / 100) * 100;
      tiles.push(`<div class="mt"><div class="mt-k">Average maintenance cost</div><div class="mt-v">₹${yr(s.lo).toLocaleString('en-IN')}${s.hi > s.lo * 1.05 ? `–${yr(s.hi).toLocaleString('en-IN')}` : ''}<small>/year</small></div>
        <div class="mt-s">${s.est ? `Our estimate for routine servicing over 5 years (about ₹${Math.round(s.lo / 1000)}k in all)` : `Routine servicing, about ₹${Math.round(s.lo / 1000)}k${s.hi > s.lo * 1.05 ? `–${Math.round(s.hi / 1000)}k` : ''} over 5 years or 50,000 km.`}</div>
        <div class="mt-tag">${s.est ? 'Estimate' : 'Service schedule'}</div></div>`);
    }
    // real-world mileage: overall average, then averages by fuel and by gearbox
    const ml = (e.mileage || []).filter((x) => !x.ev);
    const val = (x) => x.tested || x.user || (x.arai ? Math.round(x.arai * 0.8 * 10) / 10 : null);
    const rowsM = ml.map((x) => ({ x, v: val(x), auto: !/manual/i.test(x.tr || '') })).filter((r) => r.v);
    const evs = (e.mileage || []).filter((x) => x.ev && x.evRange);
    const avg = (arr) => (arr.length ? Math.round((arr.reduce((t, r) => t + r.v, 0) / arr.length) * 10) / 10 : null);
    if (rowsM.length) {
      const liquid = rowsM.filter((r) => r.x.fuel !== 'CNG');
      const head = avg(liquid.length ? liquid : rowsM), cngOnly = !liquid.length;
      const groups = [['Petrol', rowsM.filter((r) => r.x.fuel === 'Petrol')], ['Diesel', rowsM.filter((r) => r.x.fuel === 'Diesel')], ['CNG', rowsM.filter((r) => r.x.fuel === 'CNG')], ['Hybrid', rowsM.filter((r) => /hybrid/i.test(r.x.fuel))], ['Automatic', liquid.filter((r) => r.auto)], ['Manual', liquid.filter((r) => !r.auto)]].filter(([, g]) => g.length);
      const kind = rowsM.some((r) => r.x.tested) ? 'Road-tested' : rowsM.some((r) => r.x.user) ? 'Owner data' : 'Estimate';
      const how = (g) => (g.every((r) => r.x.tested) ? 'tested' : g.some((r) => r.x.tested || r.x.user) ? 'real' : 'est.');
      tiles.push(`<div class="mt"><div class="mt-k">Real-world mileage</div><div class="mt-v">${head}<small>${cngOnly ? ' km/kg' : ' km/l'} average</small></div>
        <div class="mt-s">Road tests and owner reports</div>
        <ul class="mt-list">${groups.map(([n, g]) => `<li><span>${n}</span><b>${avg(g)}${n === 'CNG' ? ' km/kg' : ' km/l'}</b><em>${how(g)}</em></li>`).join('')}${evs.length ? `<li><span>Electric range</span><b>${Math.round(evs.reduce((t, x) => t + x.evRange, 0) / evs.length)} km</b><em>tested</em></li>` : ''}</ul>
        <div class="mt-tag">${kind}</div></div>`);
    } else if (evs.length) {
      const r = Math.round(evs.reduce((t, x) => t + x.evRange, 0) / evs.length);
      tiles.push(`<div class="mt"><div class="mt-k">Real-world range</div><div class="mt-v">${r}<small> km</small></div><div class="mt-s">Tested range on a full charge</div><div class="mt-tag">Road-tested</div></div>`);
    }
    // resale
    if (e.resale) {
      const r = e.resale;
      tiles.push(`<div class="mt"><div class="mt-k">Resale value in 5 years</div><div class="mt-v">${fmtL(r.lo)}<small> – ${fmtL(r.hi)}</small></div>
        <div class="mt-s">About ${r.pct}% of today's ex-showroom price, based on how ${esc(m.brand)} ${esc(m.body === 'MUV / MPV' ? 'MUVs' : m.body + 's')} usually hold value. Condition, kilometres and city all matter.</div><div class="mt-tag">Estimate</div></div>`);
    }
    // user satisfaction
    if (e.rating) {
      const g = e.rating;
      tiles.push(`<div class="mt"><div class="mt-k">Average user satisfaction</div><div class="mt-v">${g.avg.toFixed(1)}<small>/5</small> ${stars(Math.round(g.avg))}</div>
        <div class="mt-s">From ${g.count.toLocaleString('en-IN')} owner ratings across ${Object.keys(g.sources).length} leading Indian car sites</div></div>`);
    }
    if (!tiles.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<div class="cp-sec-head"><h3 class="display">Owning one</h3></div><div class="mt-grid">${tiles.join('')}</div>`;
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
    // a ticked feature that every remaining variant has stays ticked (shown as a note); one that none has is dropped
    const allHave = [...cp.need].filter((k) => !diff.some((f) => f.key === k) && known.length && known.every((c) => c.feat(k) === '1'));
    for (const k of [...cp.need]) if (!diff.some((f) => f.key === k) && !allHave.includes(k)) cp.need.delete(k);
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
      pick = `<div class="vh-pick" data-k="${esc(best.id)}"><div class="vh-pick-k">${cp.need.size || cp.fuel.size || cp.gear.size ? 'Your Right Variant' : 'Cheapest variant'}</div>
        <div class="vh-pick-main"><div><h3>${esc(best.variant)}</h3><div class="muted small">${esc([best.fuel, gearTxt(best)].join(' · '))}${cp.need.size ? ` · has all ${cp.need.size} feature${cp.need.size > 1 ? 's' : ''} you picked` : ''}${match.length > 1 ? ` · ${match.length - 1} more variant${match.length > 2 ? 's' : ''} also fit` : ''}</div></div>
        <div class="vh-pick-p"><b>${lakh(best.orTotal)}</b><span class="muted small">on-road · ex-showroom ${lakh(best.or.ex)}</span></div></div>
        ${adds.length ? `<div class="vh-up">Step up to <b>${esc(nxt.variant)}</b> (+${lakh(nxt.orTotal - best.orTotal).replace('₹', '₹')}) for ${esc(adds.slice(0, 5).map((f) => f.label).join(', '))}${adds.length > 5 ? ` and ${adds.length - 5} more` : ''}.</div>` : ''}
        <ul class="vh-pick-specs">${[best.seats ? best.seats + ' seats' : '', best.airbags ? best.airbags + ' airbags' : '', rng(best) !== '–' ? rng(best) : '', best.cc ? best.cc + ' cc' : '', best.drive && best.drive !== '2WD' ? best.drive : ''].filter(Boolean).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        ${cp.need.size ? `<ul class="vh-pick-has">${[...cp.need].map((k) => `<li>${esc(FLABEL(k).replace(/ \(.*\)$/, ''))}</li>`).join('')}</ul>` : ''}
        <div class="vh-pick-act"><button class="btn primary" type="button" data-vid="${esc(best.id)}">Price break-up</button><a class="btn ghost" href="#chDealer" data-jump="chDealer">Book a test drive</a></div></div>`;
    } else pick = `<div class="vh-pick none">${SORRY_ICON}<div><b>Sorry, no ${esc(m.model)} variant has all of that.</b><div class="muted small">Untick a feature to see the closest variants.</div></div></div>`;
    const grp = (name, vals, set) => vals.length > 1 || set.size ? `<div class="group"><div class="label">${name}</div><div class="chips">${vals.map((v) => `<button type="button" class="chip" data-cpf="${name === 'Fuel' ? 'fuel' : 'gear'}" data-v="${esc(v)}" aria-pressed="${set.has(v)}">${esc(v)}</button>`).join('')}</div></div>` : '';
    const cnt = (k) => known.filter((c) => c.feat(k) === '1').length;
    const noFeat = known.length ? '<p class="muted">These variants have the same feature list.</p>' : `<div class="note">${esc(m.brand)} doesn't publish a variant-wise feature list, so we can only compare prices and specs here.</div>`;
    box.innerHTML = `<div class="vh-split${all.length > 1 ? '' : ' one'}">
      <div class="vh-left">
        ${all.length > 1 ? `<div class="vh-step">What do you want?</div>${cp.carried ? `<p class="hint vh-carried">${cp.carriedFrom === 'compare' ? 'Your must-haves and nice-to-haves from Compare are already ticked.' : 'Your choices from the search are already ticked.'}</p>` : ''}
        <div class="vh-filters">${grp('Fuel', fuels, cp.fuel)}${grp('Gearbox', gears, cp.gear)}</div>
        ${diff.length ? `<div class="group"><div class="label">Features that differ <span class="muted">· tap the ones you want</span></div><div class="chips vh-need">${(cp.more ? diff : diff.filter((f, i) => i < 12 || cp.need.has(f.key))).map((f) => `<button type="button" class="chip" data-need="${f.key}" aria-pressed="${cp.need.has(f.key)}">${esc(f.label)}<small>${cnt(f.key)}/${known.length}</small></button>`).join('')}${diff.length > 12 ? `<button type="button" class="chip more" data-more>${cp.more ? 'Fewer' : `+${diff.filter((f, i) => i >= 12 && !cp.need.has(f.key)).length} more`}</button>` : ''}</div></div>` : noFeat}
        ${allHave.length ? `<p class="vh-all-have">✓ Every variant here has ${esc(allHave.map((k) => FLABEL(k).replace(/ \(.*\)$/, '')).join(', '))}</p>` : ''}
        ${cp.fuel.size || cp.gear.size || cp.need.size ? '<button class="link vh-reset" type="button" data-vreset>Clear my choices</button>' : ''}` : '<p class="muted">The only variant on sale.</p>'}
      </div>
      <div class="vh-right" aria-live="polite">${pick}</div>
    </div>
    <div class="vh-cmp"><div class="vh-cmp-h"><h3 class="display">Compare variants</h3><span class="muted small">${cp.all ? 'Every spec and feature' : 'Only what differs'}${pool.length < all.length ? ` · ${pool.length} of ${all.length} variants match your fuel and gearbox` : ''}</span></div>
      <div class="vh-scroll"><table class="vh-table"><thead><tr><th class="vh-c0">Variant</th>${pool.map((c) => `<th class="${c === best ? 'best' : ok(c) ? '' : 'off'}"><button type="button" data-vid="${esc(c.id)}"><span class="vh-vn">${esc(c.variant)}</span><b>${lakh(c.orTotal)}</b>${c === best ? '<em>Best fit</em>' : ''}</button></th>`).join('')}</tr></thead>
        <tbody>${specs.map(([l, fn]) => `<tr class="spec"><td class="vh-c0">${l}</td>${pool.map((c) => `<td class="${c === best ? 'best' : ok(c) ? '' : 'off'}">${esc(fn(c))}</td>`).join('')}</tr>`).join('')}
        ${ordered.map((f) => `<tr class="${cp.need.has(f.key) ? 'want' : ''}"><td class="vh-c0">${esc(f.label)}</td>${pool.map((c) => `<td class="${c === best ? 'best' : ok(c) ? '' : 'off'}">${cell(c, f.key)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${known.length ? `<label class="toggle vh-all"><input type="checkbox" data-cpall ${cp.all ? 'checked' : ''}> Also show features every variant shares</label>` : ''}</div>`;
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
    box.innerHTML = `<form class="dl-find" data-dlform><button type="button" class="btn ghost" data-dl="geo">${PIN} Use my location</button><span class="muted">or</span>
        <input class="dl-pin" name="pin" inputmode="numeric" autocomplete="postal-code" maxlength="6" pattern="[1-9][0-9]{5}" placeholder="Enter pincode" aria-label="Pincode"><button class="btn primary" type="submit">Find</button></form>
      <p class="hint dl-geo-note">Your location is only used in your browser to sort showrooms by distance. Pincodes are looked up with OpenStreetMap's Nominatim service. Showroom data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>.</p>
      <div id="dlList" aria-live="polite"></div>`;
    if (geo) listDealers(m, geo);
  }
  async function listDealers(m, geo) {
    const out = $('#dlList'); if (!out) return;
    out.innerHTML = `<p class="muted">Looking for ${esc(m.brand)} showrooms near ${esc(geo.label)}…</p>`;
    const all = await loadDealers();
    if (!$('#dlList') || cp.key !== m.brand + '|' + m.model) return;
    // one card per dealer group: if a dealer has several outlets, only its nearest one is listed
    const seenGroup = new Set();
    const nearAll = all.filter((d) => d.b === m.brand && !(/\b(service|workshop|body ?shop|spares?|accessor|parts)\b/i.test(d.n) && !/\b(sales|showroom)\b/i.test(d.n))).map((d) => ({ ...d, n: fixDealerName(d.n), km: kmBetween(geo.la, geo.lo, d.la, d.lo) })).filter((d) => d.km <= 120).sort((a, b) => a.km - b.km)
      .filter((d) => { const g = dealerGroup(d.n, m.brand); if (!g) return true; if ([...seenGroup].some((h) => h === g || (g.length > 5 && lev(g, h, 2) <= 2))) return false; seenGroup.add(g); return true; });
    // outlets mapped with no name of their own ("Hyundai") only fill in when few named dealers are near
    const named = nearAll.filter((d) => dealerGroup(d.n, m.brand));
    const near = (named.length >= 4 ? named : nearAll).slice(0, 8);
    cp.dealerModel = m;
    const gAll = `https://www.google.com/maps/search/${encodeURIComponent(m.brand + ' showroom')}/@${geo.la.toFixed(5)},${geo.lo.toFixed(5)},12z`;
    out.innerHTML = `<div class="dl-where">${PIN} Near <b>${esc(geo.label)}</b> <button class="link" type="button" data-dl="change">Change</button></div>
      ${near.length ? `<ol class="dl-list">${near.map(dealerCard).join('')}</ol>` : `<p class="muted">We don't have any ${esc(m.brand)} showrooms on our map within 120 km yet.</p>`}
      <a class="btn ghost dl-all" href="${gAll}" target="_blank" rel="noopener">See every ${esc(m.brand)} showroom near ${esc(geo.label)} on Google Maps ↗</a>
      <p class="hint">Showroom locations © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>, available under the <a href="https://opendatacommons.org/licenses/odbl/" target="_blank" rel="noopener">Open Database License</a>. Refreshed weekly. Test drives are booked on ${esc(m.brand)}'s official website, where you can pick this showroom.</p>`;
  }
  // dealer names as mapped in OpenStreetMap: fix brand misspellings; group outlets of the same dealer
  const NAME_FIX = [[/\bHuyndai\b|\bHyundia\b|\bHundai\b/gi, 'Hyundai'], [/\bMahindara\b/gi, 'Mahindra'], [/\bToyata\b/gi, 'Toyota'], [/\bMaruthi\b/gi, 'Maruti'], [/^Blu Hyundai\b/i, 'Blue Hyundai']];
  const fixDealerName = (n) => NAME_FIX.reduce((s, [re, to]) => s.replace(re, to), String(n || '').trim());
  const GENERIC = /\b(showroom|show room|sales|service|services|centre|center|workshop|outlet|branch|dealer(ship)?|authori[sz]ed|pvt|private|ltd|limited|llp|the|cars?|motors? india|nexa|arena|true value|signature|studio|ev|electric|mega|new|used)\b/g;
  function dealerGroup(n, brand) {
    let s = n.toLowerCase().replace(/[(\[].*$/, '').replace(/\s[-–|,@].*$/, '');
    for (const w of brand.toLowerCase().split(/[\s-]+/)) s = s.replace(new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), ' ');
    s = s.replace(/\b(maruti|suzuki|mercedes|benz|land|rover|range)\b/g, ' ').replace(GENERIC, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
    return s || null; // nothing distinctive left (e.g. just "Hyundai Showroom"): don't group
  }
  const NEXA = new Set(['Baleno', 'Fronx', 'Grand Vitara', 'Ignis', 'Invicto', 'Jimny', 'XL6', 'Ciaz', 'e Vitara']);
  function testDriveUrl(m) {
    const T = (DATA.testdrive || {})[m.brand];
    if (!T) return m.url;
    if (T.nexa && NEXA.has(m.model)) return T.nexa;
    if (T.ev && m.fuels.length === 1 && m.fuels[0] === 'Electric') return T.ev;
    return T.url;
  }
  function dealerCard(d) {
    const m = cp.dealerModel;
    const area = d.c || nearestCity(d.la, d.lo);
    const addr = [d.a, area, d.p].filter(Boolean).join(', ');
    const tel = d.t ? d.t.replace(/[^\d+]/g, '') : '';
    const T = (DATA.testdrive || {})[m.brand] || {};
    const web = d.w && /^https?:\/\//i.test(d.w) ? d.w : d.w ? 'https://' + d.w : '';
    const plain = !dealerGroup(d.n, m.brand); // just "Hyundai" etc. on the map
    return `<li class="dl"><div class="dl-main"><b class="dl-n">${esc(plain ? `${m.brand} showroom${area ? ', ' + area : ''}` : d.n)}</b><div class="dl-a">${esc(addr || 'Address not listed')}</div>
      <div class="dl-meta"><span class="dl-km">${d.km < 10 ? d.km.toFixed(1) : Math.round(d.km)} km away</span>${tel ? `<a class="dl-tel" href="tel:${esc(tel)}" data-ev="call" data-dealer="${esc(d.n)}">${PHONE} ${esc(d.t)}</a>` : ''}${web ? `<a class="dl-web" href="${esc(web)}" target="_blank" rel="noopener" data-ev="dealer-site" data-dealer="${esc(d.n)}">Dealer website ↗</a>` : ''}</div></div>
      <div class="dl-act"><a class="btn primary dl-td" href="${esc(testDriveUrl(m))}" target="_blank" rel="noopener" data-td data-dealer="${esc(d.n)}" data-area="${esc(area || '')}">${T.kind === 'enquiry' ? 'Ask for a test drive' : 'Book a test drive'} ↗</a></div></li>`;
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
      const ni = e.target.closest('[data-ncinfo]'); if (ni) { const box = $('#ncInfo'), open = box.hidden; box.hidden = !open; ni.setAttribute('aria-expanded', open); return; }
      const j = e.target.closest('[data-jump]'); if (j) { e.preventDefault(); if (j.closest('#cpNav') || /^ch/.test(j.dataset.jump)) { chHold = Date.now(); for (const a of document.querySelectorAll('#cpNav a')) a.classList.toggle('on', a.dataset.jump === j.dataset.jump); } $('#' + j.dataset.jump).scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      const hs = e.target.closest('[data-hs]'); if (hs) { heroGo(gal.i + Number(hs.dataset.hs)); return; }
      const hi = e.target.closest('[data-hi]'); if (hi) { heroGo(Number(hi.dataset.hi)); return; }
      const op = e.target.closest('[data-open]'); if (op) { openLightbox(Number(op.dataset.open)); return; }
      const v = e.target.closest('[data-vid]'); if (v) { detail(v.dataset.vid); return; }
      const f = e.target.closest('[data-cpf]'); if (f) { const set = cp[f.dataset.cpf]; set.has(f.dataset.v) ? set.delete(f.dataset.v) : set.add(f.dataset.v); return keepY(() => drawVariants(m)); }
      if (e.target.closest('[data-more]')) { cp.more = !cp.more; return keepY(() => drawVariants(m)); }
      if (e.target.closest('[data-vreset]')) { cp.fuel.clear(); cp.gear.clear(); cp.need.clear(); cp.carried = 0; return keepY(() => drawVariants(m)); }
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
  // which YouTube channel a video link goes to (the review title ends with it, e.g. "| Autocar India")
  const ytCh = (m) => { const x = expertOf(m); if (!x || !x.yt) return 'YouTube search'; const p = (x.ytT || '').split('|'); const ch = (p.length > 1 && p.pop().trim()) || 'YouTube'; return /autocar/i.test(ch) ? 'Autocar India' : ch; };
  // click tracking attributes, read by the click listener near the end of this file
  const trk = (m, kind, detail) => ` data-ev="${kind}" data-car="${mslug(m.brand, m.model)}" data-detail="${esc(detail || '')}"`;
  const ytUrl = (m) => { const x = expertOf(m); return x && x.yt ? `https://www.youtube.com/watch?v=${x.yt}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(`${m.brand} ${m.model} review`)}`; };
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
      <ol class="pr-row" id="prRow" aria-label="Your priorities, most important first">${r.prio.map((k, i) => `<li class="pr-pill" data-k="${k}" tabindex="0" title="${i ? '' : 'Most important'}"><span class="pn">${i + 1}</span><span class="pr-t">${esc(PRIO[k])}</span><span class="pr-mv"><button type="button" data-pmove="-1" aria-label="Move ${esc(PRIO[k])} up" ${i ? '' : 'disabled'}>‹</button><button type="button" data-pmove="1" aria-label="Move ${esc(PRIO[k])} down" ${i < 3 ? '' : 'disabled'}>›</button></span></li>`).join('')}</ol>
      <span class="pr-hint muted">Use the arrows to reorder</span>`;
  }
  function setPrio(order) {
    if (!state.rec || order.join() === state.rec.prio.join()) return;
    const before = new Map($$('.pr-pill').map((x) => { const r = x.getBoundingClientRect(); return [x.dataset.k, [r.left, r.top]]; }));
    const movedK = order.find((k, i) => state.rec.prio[i] !== k && state.rec.prio.indexOf(k) > i) || order[0];
    state.rec.prio = order; store.set('rec', state.rec); render();
    for (const x of $$('.pr-pill')) { // glide the pills to their new places so the change is easy to follow
      const b = before.get(x.dataset.k); if (!b) continue; const r = x.getBoundingClientRect(), dx = b[0] - r.left, dy = b[1] - r.top; if (!dx && !dy) continue;
      const lift = x.dataset.k === movedK;
      x.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: `translate(${dx / 2}px, ${dy / 2 - (lift ? 10 : 0)}px) scale(${lift ? 1.08 : 0.96})`, offset: 0.45 }, { transform: 'none' }], { duration: 700, easing: 'cubic-bezier(.45,.05,.25,1)' });
    }
  }
  function wirePrioBar() {
    const bar = $('#recBar'); let drag = null, barDragged = false;
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pmove]'); if (!b || !state.rec) return;
      const k = b.closest('.pr-pill').dataset.k, o = state.rec.prio.slice(), i = o.indexOf(k), j = i + Number(b.dataset.pmove);
      if (j < 0 || j > 3) return; [o[i], o[j]] = [o[j], o[i]]; setPrio(o);
      const f = $(`.pr-pill[data-k="${k}"] [data-pmove="${b.dataset.pmove}"]`); (f && !f.disabled ? f : $(`.pr-pill[data-k="${k}"]`)).focus();
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
    state.rec = null; store.set('rec', null); state.tab = 'all';
    for (const k of SETS) state[k].clear(); state.budgetMin = state.budgetMax = '';
    state.sort = 'price'; $('#sort').value = 'price'; $('#sort option[value="rec"]').hidden = true;
    saveFilters(); buildFilters(); render();
  }
  // a clean cars list: no finder ranking, filters, search or open rows
  function browseAll() {
    state.rec = null; store.set('rec', null); state.tab = 'all'; store.set('tab', 'all');
    clearFilters(); state.page = 1; state.open.clear();
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
          <div class="subs">${state.rec.prio.map((k) => `<div class="sub${m.est[k] ? ' est' : ''}"${m.est[k] ? ' title="Not rated separately by experts and not published by the maker; estimated from the overall score"' : ''}><span>${esc(PRIO[k])}</span>${bar10(m.sub[k])}<b>${m.est[k] ? '~' : ''}${m.sub[k].toFixed(1)}</b></div>`).join('')}</div>
        </div>
        <div class="price"><div class="match"><b>${m.match.toFixed(1)}</b><span>/10 match</span></div><div class="big">${lakh(c.orTotal)}</div><div class="small">on-road · ex-showroom ${lakh(c.or.ex)}</div></div>
      </div>
      ${x ? `<div class="expert"><div class="xs"><span class="xbadge">Expert ${x.s ? esc(x.s) + '/10' : 'review'}</span>${x.basedOn ? `<span class="muted"> (review of the ${esc(x.basedOn)})</span>` : ''}</div><ul class="pc">${pros}</ul></div>` : `<div class="expert"><span class="muted">No expert review yet — ranked on specs.</span></div>`}
      <div class="card-foot"><a class="watch" href="${esc(ytUrl(m))}" target="_blank" rel="noopener"${trk(m, 'video', ytCh(m))}><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21.6 7.2a2.7 2.7 0 0 0-1.9-1.9C18 4.8 12 4.8 12 4.8s-6 0-7.7.5A2.7 2.7 0 0 0 2.4 7.2 28 28 0 0 0 2 12a28 28 0 0 0 .4 4.8 2.7 2.7 0 0 0 1.9 1.9c1.7.5 7.7.5 7.7.5s6 0 7.7-.5a2.7 2.7 0 0 0 1.9-1.9A28 28 0 0 0 22 12a28 28 0 0 0-.4-4.8zM10 15.1V8.9l5.2 3.1z"/></svg>${x && x.yt ? 'Watch the video review' : 'Find a video review'}</a>
        <span class="foot-links">${x && x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener"${trk(m, 'review', 'Autocar India')}>Expert review ↗</a>` : ''}<button class="link" data-toggle="${esc(key)}">${open ? 'Hide' : 'See'} ${m.vs.length} variant${m.vs.length > 1 ? 's' : ''}</button></span></div>
      ${open ? variantTable(m) : ''}
    </article>`;
  }

  // ---- welcome question + 4-step builder ----
  const wz = { step: 0, a: null, picked: [] };

  const defaults = () => ({ body: null, budget: '', fuel: null, trans: null, prio: ['features', 'mileage', 'comfort', 'value'] });
  function openWizard(step = 0) {
    wz.a = Object.assign(defaults(), state.rec ? JSON.parse(JSON.stringify(state.rec)) : {});
    wz.step = step; wz.shown = null; drawWizard();
    const d = $('#wizard'); if (!d.open) d.showModal();
  }
  function closeWizard() { $('#wizard').close(); }
  function drawWizard() {
    const a = wz.a, s = wz.step, W = $('#wizardBody');
    const dots = s ? `<div class="wz-steps" aria-label="Step ${s} of 5">${[1, 2, 3, 4, 5].map((i) => `<span class="${i < s ? 'done' : i === s ? 'on' : ''}"></span>`).join('')}<em>Step ${s} of 5</em></div>` : '';
    const close = `<button class="wz-x" type="button" data-wz="close" aria-label="Close">✕</button>`;
    let body = '', canNext = true;
    if (s === 0) {
      body = `<img class="wz-mark" src="brand/logo-day.svg" alt="Right Ride"><h2 id="wzTitle" class="display">What can we help you with?</h2>
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
      body = `<h2 id="wzTitle" class="display">What matters most?</h2><p class="muted">Use the arrows to put the most important at the top.</p>
        <ol class="tt" id="prioList" aria-label="Your priorities, most important first">${ttRows(a.prio)}</ol>`;
    }
    const nav = s ? `<div class="wz-nav"><button class="btn ghost" type="button" data-wz="back">Back</button><button class="btn primary" type="button" data-wz="next" ${canNext ? '' : 'disabled'}>${s === 5 ? 'Show my matches' : 'Next'}</button></div>` : '';
    // soft transition between steps: old step fades and drifts out, new one drifts in, the card eases to its new height
    const prev = wz.shown; wz.shown = s;
    const soft = prev != null && prev !== s && $('#wizard').open && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    let h0 = 0, ghost = null;
    if (soft) {
      h0 = W.offsetHeight;
      const ob = $('.wz-body', W);
      if (ob) { ghost = ob.cloneNode(true); ghost.removeAttribute('id'); $$('[id]', ghost).forEach((x) => x.removeAttribute('id')); ghost.classList.add('wz-ghost'); ghost.setAttribute('aria-hidden', 'true'); Object.assign(ghost.style, { top: ob.offsetTop + 'px', left: ob.offsetLeft + 'px', width: ob.offsetWidth + 'px' }); }
    }
    W.innerHTML = `${close}${dots}<div class="wz-body">${body}</div>${nav}`;
    if (soft) {
      const dir = s > prev ? 1 : -1, nb = $('.wz-body', W), ease = 'cubic-bezier(.22,.8,.24,1)';
      if (ghost) { W.appendChild(ghost); ghost.animate([{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: `translateX(${-dir * 32}px) scale(.985)`, filter: 'blur(4px)' }], { duration: 260, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' }).onfinish = () => ghost.remove(); }
      if (nb) nb.animate([{ opacity: 0, transform: `translateX(${dir * 32}px) scale(.985)`, filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 460, delay: 140, easing: ease, fill: 'backwards' });
      const h1 = W.offsetHeight;
      if (Math.abs(h1 - h0) > 2) { W.style.overflow = 'hidden'; W.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: 420, easing: ease }).onfinish = () => { W.style.overflow = ''; }; }
    }
    if (s === 5) wireTT($('#prioList'), () => wz.a.prio, (o) => { wz.a.prio = o; });
    if (s === 2) { const i = $('#wzBudget'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }
  // priorities list: tap a row to move it to the top; rows can also be dragged
  const UP_ICO = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 14l6-6 6 6"/></svg>';
  const DN_ICO = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 10l6 6 6-6"/></svg>';
  const ttRows = (o) => o.map((k, i) => `<li data-k="${k}" tabindex="0" aria-label="${PRIO[k]}, number ${i + 1}"><span class="pn">${i + 1}</span><span class="pt"><b>${PRIO[k]}${i ? '' : '<em class="tt-top">Most important</em>'}</b><small>${PRIO_HINT[k]}</small></span><span class="tt-mv"><button type="button" data-tm="-1" aria-label="Move ${PRIO[k]} up" ${i ? '' : 'disabled'}>${UP_ICO}</button><button type="button" data-tm="1" aria-label="Move ${PRIO[k]} down" ${i < o.length - 1 ? '' : 'disabled'}>${DN_ICO}</button></span></li>`).join('');
  function flipList(L, fn, skip, moved) {
    const before = new Map($$('li', L).map((c) => [c.dataset.k, c.getBoundingClientRect().top]));
    fn();
    for (const c of $$('li', L)) {
      if (c === skip) continue;
      const d = (before.get(c.dataset.k) ?? 0) - c.getBoundingClientRect().top; if (!d) continue;
      if (moved && c.dataset.k === moved) { // the card you moved lifts off, glides and settles
        c.style.zIndex = 3;
        c.animate([
          { transform: `translateY(${d}px) scale(1)`, boxShadow: '0 0 0 rgba(0,0,0,0)' },
          { transform: `translateY(${d * 0.5}px) scale(1.04)`, boxShadow: '0 18px 40px rgba(0,0,0,.22), inset 0 0 0 2px var(--brand)', offset: 0.45 },
          { transform: 'translateY(0) scale(1)', boxShadow: '0 0 0 rgba(0,0,0,0)' },
        ], { duration: 720, easing: 'cubic-bezier(.45,.05,.25,1)' }).onfinish = () => { c.style.zIndex = ''; };
      } else {
        c.animate([{ transform: `translateY(${d}px)`, opacity: 1 }, { transform: `translateY(${d * 0.5}px) scale(.98)`, opacity: .7, offset: 0.45 }, { transform: 'none', opacity: 1 }], { duration: 720, easing: 'cubic-bezier(.45,.05,.25,1)' });
      }
    }
  }
  function wireTT(L, get, set) {
    if (!L) return;
    const move = (k, d, focusBtn) => {
      const o = get().slice(), i = o.indexOf(k), j = i + d; if (j < 0 || j >= o.length) return;
      [o[i], o[j]] = [o[j], o[i]]; set(o);
      flipList(L, () => { L.innerHTML = ttRows(o); }, null, k);
      const li = $(`li[data-k="${k}"]`, L); if (!li) return;
      const btn = focusBtn && $(`[data-tm="${d}"]`, li);
      (btn && !btn.disabled ? btn : li).focus({ preventScroll: true });
    };
    L.addEventListener('click', (e) => { const b = e.target.closest('[data-tm]'); if (b) move(b.closest('li').dataset.k, Number(b.dataset.tm), true); });
    L.addEventListener('keydown', (e) => {
      const li = e.target.closest('li'); if (!li || !['ArrowUp', 'ArrowDown'].includes(e.key) || e.target.closest('button')) return;
      e.preventDefault(); move(li.dataset.k, e.key === 'ArrowUp' ? -1 : 1, false);
    });
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
    if (next === page && (next !== 'car' || arg === carSlug) && (next !== 'compare' || arg === cmpArg)) return;
    const prev = page; page = next;
    if (prev === 'cars') carsY = window.scrollY;
    const B = document.body, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const swap = () => {
      B.classList.remove('leaving', 'to-cars', 'to-home', 'to-car');
      B.dataset.page = next;
      if (next !== 'car') { document.title = ORIG_TITLE; navFromList = navFromList && next === 'cars'; }
      if (next === 'car') { carSlug = arg; renderCar(arg); window.scrollTo({ top: 0, behavior: 'instant' }); }
      else if (next === 'compare') { cmpArg = arg || ''; cmp.vsel = {}; renderCompare(cmpArg); window.scrollTo({ top: 0, behavior: 'instant' }); if (!EXTRA_DATA) loadExtras().then((x) => { EXTRA_DATA = x || {}; if (page === 'compare') keepY(() => renderCompare(cmpArg)); }); }
      else if (next === 'cars') { render(); window.scrollTo({ top: prev === 'car' ? carsY : 0, behavior: 'instant' }); }
      else { window.scrollTo({ top: 0, behavior: 'instant' }); requestAnimationFrame(placeHorizon); startLanes(); }
      if (animate && prev && !reduce) { void B.offsetWidth; B.classList.add('to-' + next); clearTimeout(showPage.t); showPage.t = setTimeout(() => B.classList.remove('to-cars', 'to-home', 'to-car'), 1100); }
    };
    if (animate && prev && !reduce && window.scrollY < 400 && prev !== 'car' && next !== 'car') { B.classList.add('leaving'); clearTimeout(showPage.l); showPage.l = setTimeout(swap, 330); }
    else swap();
  }
  function go(next, arg) {
    const h = next === 'cars' ? '#/cars' : next === 'car' ? '#/car/' + arg : next === 'compare' ? '#/compare/' + arg : '#/';
    if (location.hash !== h) location.hash = h; else showPage(next, true, arg);
  }
  function route(animate) {
    countView();
    const c = location.hash.match(/^#\/car\/([\w-]+)/);
    if (c) return showPage('car', animate, c[1]);
    const cm = location.hash.match(/^#\/compare\/([\w,-]+)/);
    if (cm) return showPage('compare', animate, cm[1]);
    showPage(/^#\/cars/.test(location.hash) ? 'cars' : 'home', animate);
  }
  // sticky chapter tabs on the car page follow the scroll
  let chObs = null, chHold = 0;
  function spyChapters() {
    if (chObs) chObs.disconnect();
    const links = [...document.querySelectorAll('#cpNav a')];
    chObs = new IntersectionObserver((ents) => {
      const vis = ents.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis && Date.now() - chHold > 900) for (const a of links) a.classList.toggle('on', a.dataset.jump === vis.target.id);
    }, { rootMargin: '-30% 0px -60% 0px' });
    for (const id of ['chRide', 'chVariant', 'chDealer']) { const el = document.getElementById(id); if (el) chObs.observe(el); }
  }
  const setTopbarH = () => { const t = document.querySelector('.topbar'); if (t) document.documentElement.style.setProperty('--topbar-h', t.offsetHeight + 'px'); };
  setTopbarH(); window.addEventListener('resize', setTopbarH);
  // ---- "Right" and "Ride" are always set like the logo: Michroma, brand red ----
  const RR_WORD = /\b(Right|Ride)\b/;
  const RR_SKIP = /^(SCRIPT|STYLE|TEXTAREA|INPUT|OPTION|SELECT|TITLE|svg|text|tspan)$/;
  function brandWords(root) {
    const base = root && (root.nodeType === 3 ? root.parentNode : root.nodeType === 1 ? root : null);
    if (!base || !base.isConnected) return;
    const walk = document.createTreeWalker(base, NodeFilter.SHOW_TEXT, { acceptNode: (n) => {
      for (let p = n.parentNode; p && p !== document.body; p = p.parentNode) if (RR_SKIP.test(p.nodeName) || (p.classList && (p.classList.contains('rrw') || p.hasAttribute('data-nobrand')))) return NodeFilter.FILTER_REJECT;
      return RR_WORD.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    } });
    const hits = []; while (walk.nextNode()) hits.push(walk.currentNode);
    for (const n of hits) {
      const f = document.createDocumentFragment();
      for (const part of n.nodeValue.split(/\b(Right|Ride)\b/)) {
        if (part === 'Right' || part === 'Ride') { const sp = document.createElement('span'); sp.className = 'rrw'; sp.textContent = part; f.appendChild(sp); }
        else if (part) f.appendChild(document.createTextNode(part));
      }
      n.parentNode.replaceChild(f, n);
    }
  }
  brandWords(document.body);
  new MutationObserver((list) => { for (const r of list) for (const n of r.addedNodes) brandWords(n); }).observe(document.body, { childList: true, subtree: true });
  // ---- visit counting (analytics.js): one page view per route, test-drive clicks as events ----
  let lastView = '';
  function countView() {
    const h = location.hash.replace(/^#/, '') || '/';
    const path = /^\/car\//.test(h) ? h : /^\/compare\//.test(h) ? '/compare' : /^\/cars/.test(h) ? '/cars' : '/';
    if (path === lastView) return; lastView = path;
    const m = /^\/car\/(.+)/.test(path) ? modelBySlug(path.slice(5)) : null;
    window.rrTrack && window.rrTrack(path, m ? `${m.brand} ${m.model}` : path === '/cars' ? 'Cars' : 'Home');
  }
  const seg = (t) => encodeURIComponent(String(t || '').trim()).replace(/%20/g, '+');
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-td],[data-ev]'); if (!a || !window.rrTrack) return;
    const m = (a.dataset.car && modelBySlug(a.dataset.car)) || cp.dealerModel || modelBySlug(carSlug); if (!m) return;
    const kind = a.hasAttribute('data-td') ? 'testdrive' : a.dataset.ev;
    const dealer = a.dataset.dealer ? `${a.dataset.dealer}${a.dataset.area ? ' (' + a.dataset.area + ')' : ''}` : (a.dataset.detail || '');
    window.rrTrack(`${kind}/${seg(m.brand)}/${seg(m.model)}/${seg(dealer)}`, `${kind}: ${m.brand} ${m.model}${dealer ? ' @ ' + dealer : ''}`, true);
  }, true);
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
      e.preventDefault();
      if (a.hasAttribute('data-fresh')) browseAll(); // "Browse all cars" on the landing page starts with no filters
      go(a.dataset.go);
    });
    // a shared link with filters, or a saved recommendation, opens straight on the cars page
    // the bare address always lands on the home page; only a shared link with filters opens the cars page
    if (!location.hash || location.hash === '#') history.replaceState(null, '', location.pathname + location.search + (/[?&](body|feats|brand|fuel|min|max|seats|trans)=/.test(location.search) ? '#/cars' : '#/'));
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
    document.addEventListener('click', (e) => { const d = $('#brandMs'); if (d && d.open && !d.contains(e.target)) d.open = false; });
    document.addEventListener('keydown', (e) => { const d = $('#brandMs'); if (e.key === 'Escape' && d && d.open) { d.open = false; d.querySelector('summary').focus(); e.stopPropagation(); } }, true);
    $('#filterBody').addEventListener('toggle', (e) => { if (e.target.id === 'brandMs' && e.target.open) { const q = $('#brandQ'); q.value = ''; $$('#brandMs .ms-opt').forEach((o) => (o.hidden = false)); q.focus({ preventScroll: true }); } }, true);
    $('#filterBody').addEventListener('input', (e) => {
      if (e.target.id === 'brandQ') { const q = e.target.value.trim().toLowerCase(); for (const o of $$('#brandMs .ms-opt')) o.hidden = !!q && !o.dataset.name.includes(q); return; }
      if (e.target.dataset.brand) { const v = e.target.dataset.brand; e.target.checked ? state.brand.add(v) : state.brand.delete(v); $('#brandSum').textContent = brandSummary(); }
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
      if (box) { cmpToggle(box.dataset.id, box.checked); return; }
      const tr = e.target.closest('tr.v'); if (tr) { detail(tr.dataset.id); return; }
      if (e.target.closest('a, button, input, .variants')) return;
      const rc = e.target.closest('.rec-card, .tile'); if (rc) openCar(rc.dataset.key);
    });
    document.addEventListener('click', (e) => {
      const r = e.target.closest('[data-rec]'); if (!r) return;
      if (r.dataset.rec === 'edit') openWizard(1); else { $('#sort option[value="rec"]').hidden = true; setTab('all'); }
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
    wireCompareBar(); wireComparePage();
    $('#modal').addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target.id === 'modal') $('#modal').close(); });
    $('#aboutLink').addEventListener('click', (e) => { e.preventDefault(); about(); });
    $('#closeFilters').addEventListener('click', closeDrawer);
    $('#applyMobile').addEventListener('click', () => { closeDrawer(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    $('#list').addEventListener('keydown', (e) => { const t = e.target.closest('.tile'); if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openCar(t.dataset.key); } });
    wireShowroom(); wirePrioBar(); wireCarPage();
  }

  // ---------------- compare up to 3 cars ----------------
  // the bar on the cars page holds 3 slots; empty slots follow the current results, a slot the user picked stays put,
  // and a slot the user cleared stays empty until they add a car
  const cmp = { slots: store.get('cmpSlots', [null, null, null]), req: store.get('cmpReq', { must: [], nice: [] }), add: 'must', all: false, vsel: {} };
  const keyOf = (m) => m.brand + '|' + m.model;
  const modelByKey = (k) => groupAll().find((m) => keyOf(m) === k);
  function cmpSource() {
    const nothing = !activeCount() && !state.q && !(state.sort === 'rec' && state.rec);
    const list = results();
    if (nothing) { const xs = (m) => (expertOf(m) || {}).s || 0; return list.slice().sort((a, b) => xs(b) - xs(a) || a.best.c.orTotal - b.best.c.orTotal); }
    return list;
  }
  function cmpKeys() {
    const src = cmpSource().map(keyOf), pinned = cmp.slots.filter((s) => s && s.key).map((s) => s.key);
    const used = new Set(pinned), out = [];
    for (const s of cmp.slots) {
      if (s && s.key) out.push(s.key);
      else if (s && s.removed) out.push(null);
      else { const k = src.find((x) => !used.has(x)); if (k) used.add(k); out.push(k || null); }
    }
    return out;
  }
  const saveCmp = () => { store.set('cmpSlots', cmp.slots); store.set('cmpReq', cmp.req); };
  function updateCompareBar() {
    const bar = $('#compareBar'); if (!bar) return;
    const keys = cmpKeys(), ms = keys.map((k) => (k ? modelByKey(k) : null));
    const n = ms.filter(Boolean).length, edited = cmp.slots.some(Boolean);
    bar.hidden = false;
    bar.innerHTML = `<div class="cb-in">
      <div class="cb-head"><b>Compare</b><span class="muted small">${edited ? 'Your picks' : 'Top 3 from your results'}</span>${edited ? '<button class="link small" type="button" data-cb="reset">Reset</button>' : ''}</div>
      <div class="cb-slots">${ms.map((m, i) => m ? `<div class="cb-slot" data-slot="${i}" title="Change ${esc(m.model)}"><div class="cb-thumb">${carImg(m, '80px')}</div><div class="cb-name"><span class="muted">${esc(m.brand)}</span><b>${esc(m.model)}</b><span class="small">from ${lakh(m.min)}</span></div>
          <div class="cb-act"><button class="cb-btn" type="button" data-cb="change" data-i="${i}" aria-label="Change ${esc(m.model)}">Change</button><button class="cb-x" type="button" data-cb="remove" data-i="${i}" aria-label="Remove ${esc(m.model)}">✕</button></div></div>`
        : `<button class="cb-slot empty" type="button" data-cb="change" data-i="${i}"><span class="cb-plus" aria-hidden="true">+</span>Add a car</button>`).join('')}</div>
      <button class="btn primary cb-go" type="button" data-cb="go" ${n < 2 ? 'disabled' : ''}>Compare ${n || ''} <span aria-hidden="true">→</span></button>
    </div>`;
  }
  function cmpPicker(i, onPick, takenKeys) {
    const d = $('#cmpPick'), taken = new Set(takenKeys || cmpKeys().filter((k, j) => k && j !== i));
    const filtered = cmpSource().filter((m) => !taken.has(keyOf(m)));
    const all = groupAll().filter((m) => !taken.has(keyOf(m))).sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
    let scope = filtered.length ? 'filtered' : 'all';
    const row = (m) => `<button type="button" class="cp-row" data-pick="${esc(keyOf(m))}"><span class="cp-th">${carImg(m, '72px')}</span><span class="cp-n"><span class="muted small">${esc(m.brand)}</span><b>${esc(m.model)}</b></span><span class="cp-p">${lakh(m.min)}</span></button>`;
    const draw = () => {
      const q = compact(($('#cmpQ') || {}).value || '');
      const base = scope === 'filtered' ? filtered : all;
      const list = q ? base.filter((m) => compact(m.brand + m.model).includes(q) || compact(m.model).includes(q)) : base;
      $('#cmpList').innerHTML = list.length ? list.slice(0, 120).map(row).join('') : `<p class="muted cp-none">No cars match.${scope === 'filtered' ? ' <button class="link" type="button" data-scope="all">Search all cars</button>' : ''}</p>`;
    };
    d.innerHTML = `<div class="cp-head"><h2>Choose a car to compare</h2><button class="btn ghost" type="button" data-close aria-label="Close">✕</button></div>
      <div class="cp-tools"><input id="cmpQ" type="search" placeholder="Search by name" autocomplete="off" aria-label="Search cars">
      <div class="seg" role="group" aria-label="Which cars"><button type="button" data-scope="filtered" aria-pressed="${scope === 'filtered'}">Your results (${filtered.length})</button><button type="button" data-scope="all" aria-pressed="${scope === 'all'}">All cars</button></div></div>
      <div id="cmpList" class="cp-list"></div>`;
    draw();
    d.oninput = (e) => { if (e.target.id === 'cmpQ') draw(); };
    d.onclick = (e) => {
      if (e.target === d || e.target.closest('[data-close]')) return d.close();
      const s = e.target.closest('[data-scope]'); if (s) { scope = s.dataset.scope; d.querySelectorAll('.seg [data-scope]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.scope === scope)); draw(); return; }
      const p = e.target.closest('[data-pick]'); if (p) { d.close(); onPick(p.dataset.pick); }
    };
    d.showModal(); setTimeout(() => $('#cmpQ').focus(), 50);
  }
  function wireCompareBar() {
    $('#compareBar').addEventListener('click', (e) => {
      let b = e.target.closest('[data-cb]');
      const sl = !b && e.target.closest('[data-slot]'); // tapping the car itself (the only way on phones) changes it
      if (sl) b = { dataset: { cb: 'change', i: sl.dataset.slot } };
      if (!b) return;
      const i = Number(b.dataset.i), act = b.dataset.cb;
      if (act === 'reset') { cmp.slots = [null, null, null]; saveCmp(); updateCompareBar(); }
      else if (act === 'remove') { const keys = cmpKeys(); cmp.slots = cmp.slots.map((s, j) => (j === i ? { removed: true } : s || (keys[j] ? { key: keys[j] } : s))); saveCmp(); updateCompareBar(); }
      else if (act === 'change') cmpPicker(i, (k) => { const keys = cmpKeys(); cmp.slots = cmp.slots.map((s, j) => (j === i ? { key: k } : s || (keys[j] ? { key: keys[j] } : s))); saveCmp(); updateCompareBar(); });
      else if (act === 'go') { const keys = cmpKeys().filter(Boolean); cmp.slots = cmpKeys().map((k) => (k ? { key: k } : { removed: true })); saveCmp(); go('compare', keys.map((k) => { const m = modelByKey(k); return mslug(m.brand, m.model); }).join(',')); }
    });
  }

  // requirements: every feature at least one of the cars offers, plus a few that aren't features
  const REQ_EXTRA = {
    auto: { label: 'Automatic gearbox', has: (c) => c.transmission === 'Automatic' },
    seven: { label: '7 seats', has: (c) => (c.seats || 0) >= 6 },
    fiveStar: { label: '5-star crash rating', model: true },
    mileage: { label: 'Low running cost (mileage / range)', has: () => true },
    awd: { label: '4x4 / AWD', has: (c) => c.drive !== '2WD' },
    ev: { label: 'Electric', has: (c) => c.fuel === 'Electric' },
    diesel: { label: 'Diesel engine', has: (c) => c.fuel === 'Diesel' },
    cng: { label: 'CNG option', has: (c) => c.fuel === 'CNG' },
    hybrid: { label: 'Hybrid', has: (c) => /hybrid/i.test(c.fuel) },
    space: { label: 'Space (cabin and boot)', model: true },
    resale: { label: 'Resale value', model: true },
  };
  // option groups on the compare page
  const REQ_INTERIOR = new Set(['touchscreen', 'androidAuto', 'wirelessAA', 'connected', 'digitalCluster', 'wirelessCharger', 'premiumAudio', 'hud', 'voiceCommands', 'autoClimate', 'dualZone', 'rearAC', 'keyless', 'pushStart', 'poweredSeat', 'ventilated', 'autoIRVM', 'paddleShifters', 'rearArmrest', 'tiltTelescopic', 'ambient', 'leather', 'airPurifier', 'massage', 'captainSeats']);
  const REQ_EXTERIOR = new Set(['sunroof', 'panoramic', 'powerTailgate', 'ledHeadlamps', 'ledDRL', 'alloys', 'fogLamps', 'roofRails', 'autoHeadlamps', 'rainWipers', 'foldingORVM']);
  const REQ_GROUPS = [['basics', 'The basics', 'Running costs, space, safety and driving'], ['interior', 'Interior features', 'Screens, comfort and convenience inside'], ['exterior', 'Exterior features', 'Roof, lights, wheels and tailgate']];
  const reqGroup = (k) => (REQ_INTERIOR.has(k) ? 'interior' : REQ_EXTERIOR.has(k) ? 'exterior' : 'basics');
  // extra words people search with
  const REQ_ALIAS = { space: 'room roomy spacious boot luggage legroom headroom cabin family big', resale: 'resale value depreciation sell later hold value', mileage: 'fuel economy efficiency kmpl running cost range', auto: 'automatic at amt cvt dct gearbox', seven: '7 seater seats family', fiveStar: 'safety ncap crash safe', wirelessAA: 'carplay android auto wireless', androidAuto: 'carplay android auto', adas: 'adas driver assist lane', camera360: '360 camera surround', awd: '4wd 4x4 awd offroad', sunroof: 'sunroof roof', panoramic: 'panoramic sunroof', ventilated: 'cooled seats ventilated' };
  // the order people most often ask for these (used to pick the first 15 shown)
  const REQ_RANK = ['sunroof', 'auto', 'mileage', 'space', 'resale', 'airbags6', 'fiveStar', 'adas', 'camera360', 'ventilated', 'wirelessAA', 'autoClimate', 'cruise', 'wirelessCharger', 'rearCamera', 'premiumAudio', 'panoramic', 'seven', 'poweredSeat', 'digitalCluster', 'connected', 'keyless', 'ledHeadlamps', 'rearAC', 'hud', 'tpms', 'esc', 'isofix', 'androidAuto', 'touchscreen', 'alloys', 'pushStart', 'epb', 'rearSensors', 'frontSensors', 'blindSpot', 'dualZone', 'ambient', 'leather', 'paddleShifters', 'driveModes', 'powerTailgate', 'awd', 'ev', 'diesel', 'cng', 'hybrid'];
  const reqLabel = (k) => (REQ_EXTRA[k] ? REQ_EXTRA[k].label : FIDX[k] != null ? FLABEL(k).replace(/ \(.*\)$/, '') : k);
  const ncapOf = (m) => (DATA.ncap || {})[keyOf(m)] || null;
  function reqOptions(ms) {
    const ok = (k) => {
      if (k === 'fiveStar') return ms.some((m) => (ncapOf(m) || {}).stars >= 4);
      if (k === 'mileage' || k === 'space') return true;
      if (k === 'resale') return ms.some((m) => ((EXTRA_DATA || {})[keyOf(m)] || {}).resale);
      if (REQ_EXTRA[k]) return ms.some((m) => m.vs.some((v) => REQ_EXTRA[k].has(v.c)));
      return ms.some((m) => m.vs.some((v) => v.c.feat(k) === '1'));
    };
    const keys = [...new Set([...REQ_RANK, ...DATA.features.map((f) => f.key)])].filter((k) => (REQ_EXTRA[k] || FIDX[k] != null) && ok(k));
    return keys;
  }
  // how well one variant meets one requirement, from the experience of using it: 0 not available, 1 good, 2 great
  const UPGRADE = { sunroof: ['panoramic', 'Panoramic'], androidAuto: ['wirelessAA', 'Wireless'], rearCamera: ['camera360', '360° camera'], rearSensors: ['frontSensors', 'Front and rear'], adas: ['blindSpot', 'With blind-spot monitor'], autoClimate: ['dualZone', 'Dual-zone'], poweredSeat: ['ventilated', 'Also ventilated'], keyless: ['pushStart', 'With push-button start'], digitalCluster: ['hud', 'Plus head-up display'], cruise: ['adas', 'Adaptive (with ADAS)'], touchscreen: ['wirelessAA', 'With wireless phone mirroring'], ventilated: ['massage', 'Ventilated and massaging'], ledHeadlamps: ['autoHeadlamps', 'Automatic LED headlamps'], rearAC: ['dualZone', 'With climate zones'] };
  const PRAISE = { sunroof: /sunroof/i, panoramic: /panoramic|sunroof/i, touchscreen: /touchscreen|infotainment|screen/i, premiumAudio: /audio|sound|speaker/i, ventilated: /ventilat/i, adas: /adas|driver assist/i, camera360: /360/i, autoClimate: /climate|air.?con|\bac\b/i, rearAC: /rear (ac|vents)/i, poweredSeat: /seat/i, digitalCluster: /cluster|digital/i, wirelessCharger: /wireless charg/i, hud: /head.?up/i, ambient: /ambient/i, leather: /leather|upholstery/i, cruise: /cruise/i };
  // mileage of one variant: real-world from road tests / owner reports for the same fuel and gearbox when we have it,
  // else the claimed (ARAI) figure; electric cars give range
  let EXTRA_DATA = null;
  function mileageOf(c, m) {
    const rows = ((EXTRA_DATA || {})[keyOf(m)] || {}).mileage || [];
    const auto = c.transmission === 'Automatic';
    if (c.fuel === 'Electric') {
      const ev = rows.filter((x) => x.ev && x.evRange);
      if (ev.length) return { ev: true, v: Math.round(ev.reduce((t, x) => t + x.evRange, 0) / ev.length), real: true, claimed: c.range };
      return c.range ? { ev: true, v: c.range, real: false } : null;
    }
    const fuelOk = (x) => (c.fuel === 'Hybrid' ? /hybrid/i.test(x.fuel || '') : x.fuel === c.fuel);
    const same = rows.filter((x) => !x.ev && fuelOk(x)), exact = same.filter((x) => /manual/i.test(x.tr || '') !== auto);
    const pick = (exact.length ? exact : same)[0];
    const unit = c.fuel === 'CNG' ? 'km/kg' : 'km/l';
    if (pick) {
      const real = pick.tested || pick.user;
      const claimed = pick.arai || c.mileage || null;
      if (real) return { v: real, real: true, claimed, unit, how: pick.tested ? 'road-tested' : 'owner reports' };
      if (claimed) return { v: claimed, real: false, claimed, unit };
    }
    return c.mileage ? { v: c.mileage, real: false, claimed: c.mileage, unit } : null;
  }
  function grade(k, c, m) {
    const x = expertOf(m) || {}, like = (x.like || []).join(' | '), dislike = (x.dislike || []).join(' | ');
    if (k === 'fiveStar') { const n = ncapOf(m); return !n ? { g: 0, why: 'Not crash-tested yet' } : n.stars >= 5 ? { g: 2, why: `5 stars (${n.by})` } : n.stars >= 4 ? { g: 1, why: `${n.stars} stars (${n.by})` } : { g: 0, why: `${n.stars} star${n.stars === 1 ? '' : 's'} (${n.by})` }; }
    if (k === 'mileage') {
      const ml = mileageOf(c, m);
      if (!ml) return { g: 1, why: 'Not published' };
      if (ml.ev) return ml.v >= 400 ? { g: 2, why: `${ml.v} km range` } : ml.v >= 250 ? { g: 1, why: `${ml.v} km range` } : { g: 0, weak: true, why: `${ml.v} km range` };
      const cng = ml.unit === 'km/kg', good = cng ? 22 : 15, great = cng ? 28 : 19;
      return { g: ml.v >= great ? 2 : ml.v >= good ? 1 : 0, weak: true, why: `${ml.v} ${ml.unit} ${ml.real ? 'real-world' : 'claimed'}` };
    }
    if (k === 'space') return spaceGrade(c, m, like, dislike);
    if (k === 'resale') {
      const r = ((EXTRA_DATA || {})[keyOf(m)] || {}).resale;
      if (!r || !r.pct) return { g: 1, why: 'No estimate yet' };
      return { g: r.pct >= 60 ? 2 : r.pct >= 50 ? 1 : 0, weak: true, why: `Keeps about ${r.pct}% after 5 years` };
    }
    if (k === 'auto') return c.transmission !== 'Automatic' ? { g: 0, why: 'Manual only' } : c.transType === 'AMT' ? { g: 1, why: 'AMT (jerkier shifts)' } : { g: 2, why: c.fuel === 'Electric' ? 'Electric, no gears' : c.transType || 'Automatic' };
    if (k === 'seven') return (c.seats || 0) >= 7 ? { g: 2, why: `${c.seats} seats` } : (c.seats || 0) === 6 ? { g: 1, why: '6 seats' } : { g: 0, why: `${c.seats || 5} seats` };
    if (REQ_EXTRA[k]) return REQ_EXTRA[k].has(c) ? { g: 2, why: 'Yes' } : { g: 0, why: 'Not offered' };
    const v = c.feat(k);
    if (v !== '1') return { g: 0, why: v === '?' ? 'Not listed' : 'Not on this variant' };
    if (k === 'airbags6' && (c.airbags || 0) > 6) return { g: 2, why: `${c.airbags} airbags` };
    const up = UPGRADE[k];
    if (up && c.feat(up[0]) === '1') return { g: 2, why: up[1] };
    if (PRAISE[k] && PRAISE[k].test(like)) return { g: 2, why: 'Praised by reviewers' };
    if (PRAISE[k] && PRAISE[k].test(dislike)) return { g: 1, why: 'Reviewers have reservations' };
    return { g: 1, why: up ? `Not ${up[1].toLowerCase()}` : 'Available' };
  }
  // space: size class from body and seats, nudged up or down by what reviewers say about the cabin and boot
  const SPACE_GOOD = /spacious|roomy|space|legroom|headroom|big boot|large boot|boot|practical|third.row|3rd.row/i;
  const SPACE_BAD = /cramped|tight|small boot|boot space|legroom|headroom|rear space|third.row|3rd.row|rear seat/i;
  function spaceGrade(c, m, like, dislike) {
    const seats = c.seats || 5, body = m.body || c.body || '';
    let g = seats >= 7 || body === 'MUV / MPV' ? 2 : body === 'Hatchback' ? 0 : 1;
    const base = seats >= 7 ? `${seats} seats` : body === 'MUV / MPV' ? 'MUV' : body || 'Car';
    const goodL = (like.split(' | ').find((t) => SPACE_GOOD.test(t)) || ''), badL = (dislike.split(' | ').find((t) => SPACE_BAD.test(t) && !/display|screen|info/i.test(t)) || '');
    let why = base;
    if (goodL && !badL) { g = Math.min(2, g + 1); why += ' · reviewers: ' + goodL.toLowerCase(); }
    else if (badL && !goodL) { g = Math.max(0, g - 1); why += ' · reviewers: ' + badL.toLowerCase(); }
    else if (g === 0) { g = seats >= 5 ? 1 : 0; why = 'Hatchback · compact cabin and boot'; }
    return { g, weak: true, why };
  }
  // the variant we compare: the cheapest one with every must-have (or the most of them), then the most nice-to-haves
  function cmpVariant(m) {
    const sel = cmp.vsel[keyOf(m)];
    const vs = m.vs.map((v) => v.c);
    if (sel) { const c = vs.find((c) => c.id === sel); if (c) return c; }
    const score = (c) => { const mu = cmp.req.must.map((k) => grade(k, c, m).g); return { met: mu.filter((g) => g > 0).length }; };
    const best = Math.max(...vs.map((c) => score(c).met));
    return vs.filter((c) => score(c).met === best).sort((a, b) => a.orTotal - b.orTotal)[0];
  }
  function renderCompare(arg) {
    const el = $('#comparePage');
    const ms = String(arg || '').split(',').map((s) => modelBySlug(s)).filter(Boolean).slice(0, 3);
    document.title = ms.length ? `Compare ${ms.map((m) => m.model).join(' vs ')} · Right Ride` : 'Compare cars · Right Ride';
    if (ms.length < 2) { el.innerHTML = `<div class="cp-wrap"><div class="empty sorry">${SORRY_ICON}<h2>Pick at least two cars to compare</h2><a class="btn primary" href="#/cars" data-go="cars">Choose cars</a></div></div>`; return; }
    // features ticked on the cars page start out as must-haves
    if (!cmp.req.must.length && !cmp.req.nice.length) { cmp.req.must = [...featsOn()].slice(0, 5); if (state.trans.has('Automatic')) cmp.req.must.unshift('auto'); cmp.req.must = cmp.req.must.slice(0, 5); }
    const opts = reqOptions(ms);
    cmp.req.must = cmp.req.must.filter((k) => opts.includes(k)); cmp.req.nice = cmp.req.nice.filter((k) => opts.includes(k));
    const chosen = new Set([...cmp.req.must, ...cmp.req.nice]);
    const shown = opts;
    const cars = ms.map((m) => ({ m, c: cmpVariant(m) }));
    const rows = [...cmp.req.must.map((k) => ({ k, must: true })), ...cmp.req.nice.map((k) => ({ k, must: false }))];
    for (const car of cars) {
      car.g = rows.map((r) => grade(r.k, car.c, car.m));
      car.met = rows.filter((r, i) => r.must && car.g[i].g > 0).length;
      car.pts = rows.reduce((s, r, i) => s + car.g[i].g * (r.must ? 3 : 1), 0);
      car.great = car.g.filter((x) => x.g === 2).length;
    }
    const nMust = cmp.req.must.length;
    let best = null, why = '';
    if (rows.length) {
      const rank = cars.slice().sort((a, b) => b.met - a.met || b.pts - a.pts || a.c.orTotal - b.c.orTotal);
      best = rank[0];
      const r2 = rank[1];
      const missers = cars.filter((c) => c !== best && c.met < nMust).map((c) => c.m.model);
      const allMust = nMust && best.met === nMust;
      const tie = cars.some((c) => c !== best && c.met === best.met && c.pts === best.pts);
      why = (allMust ? `has all ${nMust} of your must-haves` : nMust ? `has ${best.met} of your ${nMust} must-haves, more than the others` : 'scores best on what you asked for')
        + (missers.length && allMust ? ` (${missers.join(' and ')} ${missers.length > 1 ? 'miss' : 'misses'} at least one)` : '')
        + (tie ? ', and costs the least among equally good matches' : r2 && best.pts > r2.pts && allMust && r2.met === nMust ? ', and does them better' : '');
    }
    const pill = (x) => `<span class="gr g${x.g}">${x.g === 2 ? 'Great' : x.g === 1 ? 'Good' : x.weak ? 'Weak' : 'Not available'}</span><span class="gr-why">${esc(x.why)}</span>`;
    const higher = (car, k) => { const up = car.m.vs.map((v) => v.c).filter((c) => c.orTotal > car.c.orTotal && grade(k, c, car.m).g > 0).sort((a, b) => a.orTotal - b.orTotal)[0]; return up ? `<span class="gr-up">On ${esc(up.variant)} (+${lakh(up.orTotal - car.c.orTotal)})</span>` : ''; };
    const bucket = (name, list, max) => `<div class="rq-bucket${cmp.add === name ? ' on' : ''}" data-bucket="${name}"><div class="rq-bh"><b>${name === 'must' ? 'Must have' : 'Nice to have'}</b><span class="muted small">${list.length}/${max}</span></div>
      <div class="rq-chosen">${list.length ? list.map((k) => `<button type="button" class="chip on" data-unreq="${k}" data-drag="${k}">${esc(reqLabel(k))} ✕</button>`).join('') : `<span class="muted small rq-drop-hint">Drag options here, or ${cmp.add === name ? 'tap them below' : 'tap this box, then tap options'}</span>`}</div></div>`;
    const basics = [
      ['On-road price', (car) => `<b>${lakh(car.c.orTotal)}</b><span class="gr-why">${esc(car.c.variant)}</span>`],
      ['Price range', (car) => `${lakh(car.m.min)}${car.m.max > car.m.min ? ' – ' + lakh(car.m.max) : ''}`],
      ['Safety rating', (car) => { const n = ncapOf(car.m); return n ? `${stars(n.stars)}<span class="gr-why">${esc(n.by)}</span>` : '<span class="muted">Not tested</span>'; }],
      ['Mileage / range', (car) => { const ml = mileageOf(car.c, car.m); if (!ml) return '<span class="muted">Not published</span>'; if (ml.ev) return `<b>${ml.v} km</b><span class="gr-why">${ml.real ? 'tested range' : 'claimed range'}${ml.real && ml.claimed ? ` · claimed ${ml.claimed} km` : ''}</span>`; return `<b>${ml.v} ${ml.unit}</b><span class="gr-why">${ml.real ? `real-world (${ml.how})` : 'claimed (ARAI)'}${ml.real && ml.claimed ? ` · claimed ${ml.claimed}` : ''}</span>`; }],
      ['Fuel · gearbox', (car) => esc([...car.m.fuels].join(', ')) + '<span class="gr-why">' + esc(car.m.trans.join(', ')) + '</span>'],
      ['Seats', (car) => esc(String(car.c.seats || '–'))],
      ['Expert score', (car) => { const x = expertOf(car.m); return x && x.s ? `<b>${esc(x.s)}</b>/10` : '–'; }],
    ];
    el.innerHTML = `<div class="cp-wrap cmp-page">
      <button class="cp-back" type="button" data-go="cars"><span aria-hidden="true">‹</span> Back to cars</button>
      <h1 class="ch-t cmp-title">Compare to find your Right Ride</h1>
      <section class="cp-sec rq">
        <div class="rq-top"><div><h2 class="display">What matters to you?</h2><p class="muted">Pick up to 5 must-haves and 5 nice-to-haves: drag options into a box, or tap them. We'll rate each car on how well it does each one.</p></div></div>
        <div class="rq-buckets">${bucket('must', cmp.req.must, 5)}${bucket('nice', cmp.req.nice, 5)}</div>
        <div class="rq-opts"><div class="label">Add to <b>${cmp.add === 'must' ? 'Must have' : 'Nice to have'}</b> <span class="seg rq-seg" role="group" aria-label="Add to"><button type="button" data-add="must" aria-pressed="${cmp.add === 'must'}">Must have</button><button type="button" data-add="nice" aria-pressed="${cmp.add === 'nice'}">Nice to have</button></span></div>
          <label class="rq-search"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input type="search" id="rqQ" placeholder="Search features: boot, resale, sunroof…" autocomplete="off" aria-label="Search features" value="${esc(cmp.q || '')}"></label>
          <div class="chips rq-groups" id="rqChips">${REQ_GROUPS.map(([g, title, sub]) => { const gk = shown.filter((k) => reqGroup(k) === g), open = (cmp.allG || {})[g]; return `<div class="rq-grp" data-grp="${g}"><div class="rq-grp-h"><b>${title}</b><span class="muted small">${sub}</span>${gk.length > 6 ? `<button type="button" class="link rq-grp-all" data-grpall="${g}">${open ? 'Show fewer' : `See all ${gk.length}`}</button>` : ''}</div><div class="chips">${gk.map((k) => [k]).map(([k], i) => `<button type="button" class="chip${chosen.has(k) ? ' sel' : ''}" data-req="${k}" data-drag="${k}" data-rank="${i}" data-find="${esc((reqLabel(k) + ' ' + k + ' ' + (REQ_ALIAS[k] || '')).toLowerCase())}" aria-pressed="${chosen.has(k)}">${esc(reqLabel(k))}${cmp.req.must.includes(k) ? ' <small>must</small>' : cmp.req.nice.includes(k) ? ' <small>nice</small>' : ''}</button>`).join('')}</div></div>`; }).join('')}
<span class="muted small rq-none" hidden>No feature matches that. Try another word.</span></div></div>
      </section>
      <section class="cmp-grid" style="--n:${cars.length}">
        <div class="cg-row cg-cars"><div class="cg-k"></div>${cars.map((car, i) => `<div class="cg-car${best === car ? ' best' : ''}">
          ${best === car ? `<div class="cg-best">Best for you</div>` : ''}
          <a class="cg-img" href="#/car/${mslug(car.m.brand, car.m.model)}" aria-label="${esc(car.m.brand + ' ' + car.m.model)}: open the car page">${carImg(car.m, '(max-width: 700px) 30vw, 260px')}</a>
          <div class="muted small">${esc(car.m.brand)}</div><a class="cg-name" href="#/car/${mslug(car.m.brand, car.m.model)}">${esc(car.m.model)}</a>
          <label class="cg-var"><span class="sr">Variant</span><select data-vsel="${esc(keyOf(car.m))}">${car.m.vs.map((v) => v.c).sort((a, b) => a.orTotal - b.orTotal).map((c) => `<option value="${esc(c.id)}" ${c.id === car.c.id ? 'selected' : ''}>${esc(c.variant)} · ${lakh(c.orTotal)}</option>`).join('')}</select></label>
          ${rows.length ? `<div class="cg-sum">${nMust ? `<b>${car.met}/${nMust}</b> must-haves` : ''}${nMust ? ' · ' : ''}${car.great} great</div>` : ''}
          <button class="link small" type="button" data-cmpchange="${i}">Change car</button></div>`).join('')}</div>
        ${best ? `<div class="cg-why"><b>${esc(best.m.model)}</b> fits you best: it ${esc(why)}.</div>` : ''}
        ${rows.length ? `<div class="cg-sect">Your requirements</div>${rows.map((r, ri) => `<div class="cg-row"><div class="cg-k">${esc(reqLabel(r.k))}<span class="cg-tag ${r.must ? 'must' : ''}">${r.must ? 'Must have' : 'Nice to have'}</span></div>${cars.map((car) => `<div class="cg-v${best === car ? ' best' : ''}">${pill(car.g[ri])}${car.g[ri].g === 0 ? higher(car, r.k) : ''}</div>`).join('')}</div>`).join('')}`
          : `<p class="muted cg-empty">Choose your must-haves above to see how each car does.</p>`}
        <div class="cg-sect">The basics</div>
        ${basics.filter(([, fn]) => cars.some((car) => fn(car) !== '–')).map(([l, fn]) => `<div class="cg-row"><div class="cg-k">${l}</div>${cars.map((car) => `<div class="cg-v${best === car ? ' best' : ''}">${fn(car)}</div>`).join('')}</div>`).join('')}
      </section>
      <p class="hint">"Great" means the better version of a feature (for example a panoramic sunroof, wireless phone mirroring or a 360° camera) or one that expert reviews praise. Ratings are for the variant shown; change it above.</p>
    </div>`;
    filterReq();
  }
  // put requirement k into a bucket ('must' / 'nice'), or take it out (null); false if the bucket is full
  function setReq(k, to) {
    const from = cmp.req.must.includes(k) ? 'must' : cmp.req.nice.includes(k) ? 'nice' : null;
    if (from === to) return true;
    if (to && cmp.req[to].length >= 5) { flashMsg(`You can pick up to 5 ${to === 'must' ? 'must-haves' : 'nice-to-haves'}`); return false; }
    if (from) cmp.req[from] = cmp.req[from].filter((x) => x !== k);
    if (to) cmp.req[to].push(k);
    cmp.vsel = {}; return true;
  }
  // drag a requirement chip into a bucket (mouse: drag; touch: press and hold, then drag); dropping a chosen one back on the options removes it
  function wireReqDrag(P, rerender) {
    let d = null;
    const zoneAt = (x, y) => { const el = document.elementFromPoint(x, y); if (!el) return null; const b = el.closest('[data-bucket]'); if (b) return { el: b, to: b.dataset.bucket }; const o = el.closest('.rq-opts'); return o ? { el: o, to: null } : null; };
    const clear = () => { P.querySelectorAll('.drop-on').forEach((x) => x.classList.remove('drop-on')); };
    const start = () => {
      d.on = true; const r = d.src.getBoundingClientRect();
      d.ghost = d.src.cloneNode(true); d.ghost.classList.add('drag-ghost'); d.ghost.style.width = r.width + 'px';
      d.dx = d.x0 - r.left; d.dy = d.y0 - r.top; document.body.appendChild(d.ghost); d.src.classList.add('dragging'); document.body.classList.add('rq-dragging');
      if (navigator.vibrate && d.touch) navigator.vibrate(12);
      move(d.x0, d.y0);
    };
    const move = (x, y) => { d.ghost.style.transform = `translate(${x - d.dx}px, ${y - d.dy}px)`; clear(); const z = zoneAt(x, y); if (z && (z.to || d.chosen)) z.el.classList.add('drop-on'); };
    const end = (x, y) => {
      const dd = d; d = null; clearTimeout(dd.t); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onCancel); window.removeEventListener('touchmove', noScroll);
      if (!dd.on) return;
      dd.ghost.remove(); dd.src.classList.remove('dragging'); document.body.classList.remove('rq-dragging'); clear();
      P.dataset.justDragged = '1'; setTimeout(() => delete P.dataset.justDragged, 0);
      if (x == null) return;
      const z = zoneAt(x, y);
      if (z && z.to) { if (setReq(dd.k, z.to)) { cmp.add = z.to; rerender(); } }
      else if (z && dd.chosen) { setReq(dd.k, null); rerender(); }
    };
    const onMove = (e) => {
      if (!d) return;
      const far = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
      if (!d.on) { if (d.touch) { if (far > 10) end(); return; } if (far > 6) start(); else return; }
      move(e.clientX, e.clientY);
    };
    const onUp = (e) => end(e.clientX, e.clientY);
    const onCancel = () => end();
    const noScroll = (e) => { if (d && d.on) e.preventDefault(); };
    P.addEventListener('pointerdown', (e) => {
      const c = e.target.closest('[data-drag]'); if (!c || e.button > 0) return;
      d = { src: c, k: c.dataset.drag, chosen: c.hasAttribute('data-unreq') || cmp.req.must.includes(c.dataset.drag) || cmp.req.nice.includes(c.dataset.drag), x0: e.clientX, y0: e.clientY, touch: e.pointerType !== 'mouse', on: false };
      if (d.touch) d.t = setTimeout(() => d && !d.on && start(), 260);
      window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onCancel);
      window.addEventListener('touchmove', noScroll, { passive: false });
    });
    P.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-drag]')) e.preventDefault(); });
    // a drag must not also count as a tap
    P.addEventListener('click', (e) => { if (P.dataset.justDragged) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  }
  function filterReq() {
    const P = $('#comparePage');
      const box = $('#rqChips', P); if (!box) return;
      const q = (cmp.q || '').trim().toLowerCase(), words = q.split(/\s+/).filter(Boolean);
      let n = 0;
      box.querySelectorAll('[data-rank]').forEach((b) => {
        const show = words.length ? words.every((w) => b.dataset.find.includes(w)) : (cmp.allG || {})[b.closest('[data-grp]').dataset.grp] || Number(b.dataset.rank) < 6 || b.classList.contains('sel');
        b.hidden = !show; if (show) n++;
      });
      box.querySelectorAll('.rq-grp').forEach((g) => { g.hidden = !g.querySelector('[data-rank]:not([hidden])'); });
      box.querySelectorAll('[data-grpall]').forEach((x) => { x.hidden = !!words.length; });
      $('.rq-none', box).hidden = n > 0;
    }
  function wireComparePage() {
    const P = $('#comparePage');
    const rerender = () => { saveCmp(); keepY(() => renderCompare(cmpArg)); };
    wireReqDrag(P, rerender);
    P.addEventListener('input', (e) => { if (e.target.id === 'rqQ') { cmp.q = e.target.value; filterReq(); } });
    P.addEventListener('click', (e) => {
      if (e.target.closest('a[href^="#/car/"]')) { cp.fromCmp = true; cp.key = null; return; }
      const a = e.target.closest('[data-add]'); if (a) { cmp.add = a.dataset.add; return rerender(); }
      const bk = e.target.closest('[data-bucket]'); if (bk && !e.target.closest('[data-unreq]')) { cmp.add = bk.dataset.bucket; return rerender(); }
      const u = e.target.closest('[data-unreq]'); if (u) { const k = u.dataset.unreq; cmp.req.must = cmp.req.must.filter((x) => x !== k); cmp.req.nice = cmp.req.nice.filter((x) => x !== k); cmp.vsel = {}; return rerender(); }
      const r = e.target.closest('[data-req]');
      if (r) {
        const k = r.dataset.req, list = cmp.req[cmp.add], other = cmp.add === 'must' ? 'nice' : 'must';
        if (list.includes(k)) cmp.req[cmp.add] = list.filter((x) => x !== k);
        else { cmp.req[other] = cmp.req[other].filter((x) => x !== k); if (list.length >= 5) { flashMsg(`You can pick up to 5 ${cmp.add === 'must' ? 'must-haves' : 'nice-to-haves'}`); return; } list.push(k); }
        cmp.vsel = {}; return rerender();
      }
      const ga = e.target.closest('[data-grpall]'); if (ga) { cmp.allG = { ...(cmp.allG || {}), [ga.dataset.grpall]: !(cmp.allG || {})[ga.dataset.grpall] }; return rerender(); }
      const ch = e.target.closest('[data-cmpchange]');
      if (ch) {
        const i = Number(ch.dataset.cmpchange), slugs = cmpArg.split(',');
        const taken = slugs.filter((x, j) => j !== i).map((x) => { const mm = modelBySlug(x); return mm && keyOf(mm); }).filter(Boolean);
        cmpPicker(-1, (k) => { const m = modelByKey(k); slugs[i] = mslug(m.brand, m.model); cmp.slots = slugs.map((x) => { const mm = modelBySlug(x); return mm ? { key: keyOf(mm) } : { removed: true }; }).concat([null, null, null]).slice(0, 3); cmp.vsel = {}; saveCmp(); go('compare', slugs.join(',')); }, taken);
      }
    });
    P.addEventListener('change', (e) => { const s = e.target.closest('[data-vsel]'); if (s) { cmp.vsel[s.dataset.vsel] = s.value; keepY(() => renderCompare(cmpArg)); } });
  }
  function flashMsg(t) { let n = $('#flash'); if (!n) { n = document.createElement('div'); n.id = 'flash'; n.className = 'flash'; n.setAttribute('role', 'status'); document.body.appendChild(n); } n.textContent = t; n.classList.add('on'); clearTimeout(flashMsg.t); flashMsg.t = setTimeout(() => n.classList.remove('on'), 2200); }
  let cmpArg = '';
  // ticking a variant in a variant table puts its model in the compare bar
  function cmpToggle(id, on) {
    const c = byId(id); if (!c) return; const k = c.brand + '|' + c.model, keys = cmpKeys();
    let slots = cmp.slots.map((s, j) => s || (keys[j] ? { key: keys[j] } : null));
    if (on) { if (keys.includes(k)) slots = slots.map((s) => (s && s.key === k ? { key: k } : s)); else { let j = slots.findIndex((s) => !s || s.removed); if (j < 0) j = 2; slots[j] = { key: k }; } }
    else slots = slots.map((s) => (s && s.key === k ? { removed: true } : s));
    cmp.slots = slots; saveCmp(); updateCompareBar();
  }

  async function init() {
    try {
      const [d, r] = await Promise.all([fetch('data/cars.json').then((x) => x.json()), fetch('data/rto.json').then((x) => x.json())]);
      DATA = d; RTO = r;
    } catch (e) {
      $('#resultTitle').textContent = 'Could not load car data. Please refresh.'; return;
    }
    fillStates(); loadFilters(); state.tab = store.get('tab', null); if (!TABS.some((t) => t.id === state.tab) || (state.tab === 'picks' && !state.rec)) state.tab = state.rec && state.sort === 'rec' ? 'picks' : 'all'; prep(); buildFilters(); wire(); render(); wirePages(); autoLocate();
    $('#heroStats').textContent = `${DATA.cars.length.toLocaleString('en-IN')} variants · ${new Set(DATA.cars.map((c) => c.brand + c.model)).size} models · ${DATA.brands.length} brands — priced for your state`;
    $('#updated').textContent = `Data updated ${new Date(DATA.generated).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · ${DATA.cars.length} variants from ${DATA.brands.length} brands`;
  }
  init();
})();
