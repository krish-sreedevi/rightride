// Right Ride visit counting: GoatCounter (no cookies) and Google Analytics 4.
// Both only run on the live domain (rightride.in), never on aksreedevi.in, previews or localhost.
window.RR_ANALYTICS = { goatcounter: 'rightride', ga: 'G-B102KX5D7F' };
(function () {
  const live = /^(www\.)?rightride\.in$/.test(location.hostname);
  const code = live ? window.RR_ANALYTICS.goatcounter : '';
  const ga = live ? window.RR_ANALYTICS.ga : '';
  const q = [];
  // rrTrack(path, title, isEvent): one call per route change or tracked click; sent to both services
  window.rrTrack = function (path, title, event) {
    if (!code) return;
    const hit = { path, title: title || path, event: !!event };
    if (window.goatcounter && window.goatcounter.count) window.goatcounter.count(hit); else q.push(hit);
    if (ga && window.gtag) {
      if (event) {
        // e.g. "testdrive/kia/seltos/dealer" -> event "testdrive" with car and dealer as parameters
        const [kind, brand, model, dealer] = path.split('/').map((s) => { try { return decodeURIComponent(String(s || '').replace(/\+/g, ' ')); } catch (e) { return s; } });
        if (kind === 'filter') window.gtag('event', 'filter_used', { filter_group: brand, filter_value: model }); // "filter/brand/Kia"
        else window.gtag('event', kind.replace(/[^a-z0-9_]/gi, '_'), { car_brand: brand, car_model: model, detail: dealer, label: title }); // detail = dealer, YouTube channel or maker
      } else {
        window.gtag('event', 'page_view', { page_title: title || path, page_location: location.origin + '/#' + path, page_path: path });
      }
    }
  };
  if (document.currentScript && document.currentScript.hasAttribute('data-admin')) return; // the admin page reads stats, it isn't counted
  if (!live) return;

  // GoatCounter
  window.goatcounter = { no_onload: true, allow_local: false };
  const s = document.createElement('script');
  s.async = true; s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = `https://${code}.goatcounter.com/count`;
  s.onload = () => { while (q.length) window.goatcounter.count(q.shift()); };
  document.head.appendChild(s);

  // Google Analytics 4 (gtag.js). Page views are sent by rrTrack on every route, so the automatic one is off.
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', ga, { send_page_view: false });
  const g = document.createElement('script');
  g.async = true; g.src = 'https://www.googletagmanager.com/gtag/js?id=' + ga;
  document.head.appendChild(g);
})();
