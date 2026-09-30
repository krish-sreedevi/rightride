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
    compare: new Set(), open: new Set(),
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
  const FUELS = ['Petrol', 'Diesel', 'CNG', 'Hybrid', 'PHEV', 'Electric'];
  const TTYPES = { MT: 'Manual', AMT: 'AMT', AT: 'Torque converter (AT)', CVT: 'CVT / IVT', 'e-CVT': 'e-CVT (hybrid)', DCT: 'Dual-clutch (DCT/DSG)' };
  function prep() {
    FKEYS = DATA.features.map((f) => f.key);
    DATA.features.forEach((f, i) => (FIDX[f.key] = i));
    for (const c of DATA.cars) c.feat = (k) => c.fs[FIDX[k]];
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
    if (state.body.size && !state.body.has(c.body)) return null;
    if (state.brand.size && !state.brand.has(c.brand)) return null;
    if (state.fuel.size && !state.fuel.has(c.fuel)) return null;
    if (state.trans.size && !state.trans.has(c.transmission)) return null;
    if (state.transType.size && !state.transType.has(c.transType)) return null;
    if (state.drive.size && !state.drive.has(c.drive)) return null;
    if (state.seats.size) { const s = c.seats >= 8 ? '8+' : String(c.seats); if (!state.seats.has(s)) return null; }
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
      if (!models.has(key)) models.set(key, { brand: c.brand, model: c.model, body: c.body, url: c.url, image: c.image, vs: [] });
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
    list.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier; // confirmed matches, then unconfirmed, then near-misses
      if (s === 'priceDesc') return b.best.c.orTotal - a.best.c.orTotal;
      if (s === 'match') return b.score - a.score || a.best.c.orTotal - b.best.c.orTotal;
      if (s === 'features') return b.maxFeat - a.maxFeat;
      if (s === 'mileage') return b.mileage - a.mileage;
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
    const ttypes = Object.keys(TTYPES).filter((t) => DATA.cars.some((c) => c.transType === t));
    const byBucket = {};
    for (const f of DATA.features) (byBucket[f.bucket] = byBucket[f.bucket] || []).push(f);
    const featCount = (k) => DATA.cars.filter((c) => c.feat(k) === '1').length;
    let html = `
      <details class="bucket" open><summary>Budget &amp; basics</summary>
        <div class="group"><div class="label">On-road budget (₹ lakh)</div>
          <div class="range"><input id="bmin" inputmode="decimal" placeholder="Min" value="${esc(state.budgetMin)}"><span class="muted">to</span><input id="bmax" inputmode="decimal" placeholder="Max" value="${esc(state.budgetMax)}"></div>
          <div class="chips" style="margin-top:6px">${[[0, 8], [8, 12], [12, 18], [18, 25], [25, 40], [40, 80], [80, '']].map(([a, b]) => `<button type="button" class="chip" data-budget="${a},${b}">${b === '' ? a + 'L+' : (a ? a + '–' : 'Under ') + b + 'L'}</button>`).join('')}</div>
        </div>
        <div class="group"><div class="label">Body type</div>${chips('body', bodies, state.body)}</div>
        <div class="group"><div class="label">Seats</div>${chips('seats', ['4', '5', '6', '7', '8+'], state.seats)}</div>
        <div class="group"><div class="label">Brand</div>${chips('brand', brands, state.brand)}</div>
      </details>
      <details class="bucket" open><summary>Fuel &amp; transmission</summary>
        <div class="group"><div class="label">Fuel type</div>${chips('fuel', fuels, state.fuel)}</div>
        <div class="group"><div class="label">Transmission</div>${chips('trans', ['Manual', 'Automatic'], state.trans)}</div>
        <div class="group"><div class="label">Automatic type</div>${chips('transType', ttypes.filter((t) => t !== 'MT'), state.transType, TTYPES)}</div>
        <div class="group"><div class="label">Drive</div>${chips('drive', ['2WD', 'AWD/4x4'], state.drive)}</div>
      </details>`;
    for (const b of DATA.buckets) {
      const fs = (byBucket[b] || []).filter((f) => featCount(f.key) > 0);
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

  // ---------------- UI: results ----------------
  const FLABEL = (k) => DATA.features[FIDX[k]].label;
  function render() {
    const list = results();
    const nV = list.reduce((s, m) => s + m.vs.length, 0);
    const stName = RTO.states[state.st].name;
    $('#resultTitle').textContent = list.length ? `${list.length} model${list.length > 1 ? 's' : ''} · ${nV} variants match` : 'No cars match yet';
    $('#resultSub').textContent = `On-road prices estimated for ${stName}.` + (state.feats.size ? ' Cars with every selected feature are listed first.' : ' Pick features on the left to narrow down.');
    const act = [];
    for (const k of state.feats) act.push(`<button class="chip" data-rm="feats:${k}">${esc(FLABEL(k))} ✕</button>`);
    for (const n of ['body', 'fuel', 'trans', 'transType', 'drive', 'seats', 'brand']) for (const v of state[n]) act.push(`<button class="chip" data-rm="${n}:${esc(v)}">${esc(TTYPES[v] && n === 'transType' ? TTYPES[v] : v)} ✕</button>`);
    if (state.budgetMin || state.budgetMax) act.push(`<button class="chip" data-rm="budget:">₹${state.budgetMin || 0}–${state.budgetMax || '∞'} L ✕</button>`);
    $('#activeChips').innerHTML = act.join('');
    $('#filterCount').textContent = act.length ? `(${act.length})` : '';
    const shown = list.slice(0, state.page * PAGE);
    $('#list').innerHTML = shown.length ? shown.map(card).join('') : `<div class="empty"><h2>Nothing matches every filter</h2><p class="muted">Try raising the budget, removing a feature, or ticking "also show cars missing 1 feature".</p></div>`;
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
    ].join('');
    const img = m.image ? `<img loading="lazy" src="${esc(m.image)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph',textContent:'${esc(m.model[0])}'}))">` : `<span class="ph">${esc(m.model[0])}</span>`;
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
    return `<div class="variants"><table><thead><tr><th></th><th>Variant</th><th>Fuel</th><th>Gearbox</th><th class="num hide-sm">Ex-showroom</th><th class="num">On-road*</th></tr></thead><tbody>${rows}</tbody></table><p class="muted">Jaguar currently has no models on sale in India (jaguar.in redirects to the global site while the brand moves to its new electric range), so there is nothing to list yet. Curated brands show the starting ex-showroom price per model; their features are not yet published variant-by-variant, so they appear as "not confirmed" when you filter by features.</p></div>`;
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

  // ---------------- state / location ----------------
  function fillStates() {
    const opts = Object.entries(RTO.states).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('');
    $('#state').innerHTML = opts;
    if (!RTO.states[state.st]) state.st = 'DL';
    $('#state').value = state.st;
  }
  function setState(code) { state.st = code; store.set('state', code); $('#state').value = code; recalc(); render(); }
  function detect() {
    const btn = $('#detect'); const label = btn.querySelector('span');
    if (!navigator.geolocation) { label.textContent = 'Not supported'; return; }
    label.textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition((p) => {
      const { latitude: la, longitude: lo } = p.coords;
      let best = null, bd = Infinity;
      for (const [name, st, a, b] of RTO.cities) { const d = (a - la) ** 2 + ((b - lo) * Math.cos(la * Math.PI / 180)) ** 2; if (d < bd) { bd = d; best = [name, st]; } }
      if (best) { setState(best[1]); label.textContent = best[0]; }
    }, () => { label.textContent = 'Denied'; setTimeout(() => (label.textContent = 'Detect'), 2500); }, { timeout: 10000, maximumAge: 3600e3 });
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
    history.replaceState(null, '', q.toString() ? '?' + q : location.pathname);
  }
  function loadFilters() {
    const q = new URLSearchParams(location.search);
    const o = q.toString() ? null : store.get('filters', null);
    for (const k of SETS) { const v = q.get(k) || (o && o[k] && o[k].join(',')); if (v) v.split(',').filter(Boolean).forEach((x) => state[k].add(x)); }
    state.budgetMin = q.get('min') || (o && o.budgetMin) || ''; state.budgetMax = q.get('max') || (o && o.budgetMax) || '';
    if (o) { state.allowUnknown = o.allowUnknown ?? true; state.closeMatches = o.closeMatches ?? true; state.sort = o.sort || 'price'; }
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
      if (k === 'budget') { state.budgetMin = state.budgetMax = ''; } else state[k].delete(v);
      saveFilters(); buildFilters(); render();
    });
    $('#list').addEventListener('click', (e) => {
      const t = e.target.closest('[data-toggle]');
      if (t) { const k = t.dataset.toggle; state.open.has(k) ? state.open.delete(k) : state.open.add(k); render(); return; }
      const box = e.target.closest('.cmp-box');
      if (box) { box.checked ? (state.compare.size < 4 ? state.compare.add(box.dataset.id) : (box.checked = false)) : state.compare.delete(box.dataset.id); updateCompareBar(); return; }
      const tr = e.target.closest('tr.v'); if (tr) detail(tr.dataset.id);
    });
    $('#more').addEventListener('click', () => { state.page++; render(); });
    $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; saveFilters(); render(); });
    $('#state').addEventListener('change', (e) => setState(e.target.value));
    $('#detect').addEventListener('click', detect);
    $('#reset').addEventListener('click', () => { for (const k of SETS) state[k].clear(); state.budgetMin = state.budgetMax = ''; saveFilters(); buildFilters(); render(); });
    $('#compareGo').addEventListener('click', compareView);
    $('#compareClear').addEventListener('click', () => { state.compare.clear(); render(); });
    $('#modal').addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target.id === 'modal') $('#modal').close(); });
    $('#aboutLink').addEventListener('click', (e) => { e.preventDefault(); about(); });
    $('#openFilters').addEventListener('click', () => $('#filters').classList.add('open'));
    $('#closeFilters').addEventListener('click', () => $('#filters').classList.remove('open'));
    $('#applyMobile').addEventListener('click', () => { $('#filters').classList.remove('open'); window.scrollTo(0, 0); });
  }

  async function init() {
    try {
      const [d, r] = await Promise.all([fetch('data/cars.json').then((x) => x.json()), fetch('data/rto.json').then((x) => x.json())]);
      DATA = d; RTO = r;
    } catch (e) {
      $('#resultTitle').textContent = 'Could not load car data. Please refresh.'; return;
    }
    fillStates(); loadFilters(); prep(); buildFilters(); wire(); render();
    $('#updated').textContent = `Data updated ${new Date(DATA.generated).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · ${DATA.cars.length} variants from ${DATA.brands.length} brands`;
    if (!store.get('state', null) && navigator.permissions) navigator.permissions.query({ name: 'geolocation' }).then((p) => { if (p.state === 'granted') detect(); }).catch(() => {});
  }
  init();
})();
