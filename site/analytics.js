// Right Ride visit counting: GoatCounter (no cookies), Google Analytics 4 and Microsoft Clarity (heatmaps and session replays).
// Both only run on the live domain (rightride.in), never on aksreedevi.in, previews or localhost.
window.RR_ANALYTICS = { goatcounter: 'rightride', ga: 'G-B102KX5D7F', clarity: 'ywwld7mc88' };
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
    if (window.clarity && event) window.clarity('event', String(path).split('/')[0].replace(/[^a-z0-9_]/gi, '_')); // e.g. "video", "testdrive"
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
  const afterLoad = (fn, ms) => (document.readyState === 'complete' ? setTimeout(fn, ms) : window.addEventListener('load', () => setTimeout(fn, ms), { once: true }));
  afterLoad(() => document.head.appendChild(s), 300); // counted after the page is up, so it never slows the first paint

  // Google Analytics and Clarity are heavier, so they wait until the visitor first interacts (tap, scroll, key)
  // or until 6 s after the page has loaded and the browser is idle, whichever comes first. Events sent before
  // then are queued and delivered once they load, so nothing is lost.
  const later = (fn) => {
    let done = false;
    const go = () => { if (done) return; done = true; EV.forEach((e) => removeEventListener(e, go, true)); fn(); };
    const EV = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'wheel'];
    EV.forEach((e) => addEventListener(e, go, { capture: true, passive: true, once: true }));
    afterLoad(() => (window.requestIdleCallback ? requestIdleCallback(go, { timeout: 2000 }) : go()), 6000);
  };

  // Google Analytics 4 (gtag.js). Page views are sent by rrTrack on every route, so the automatic one is off.
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', ga, { send_page_view: false });
  const g = document.createElement('script');
  g.async = true; g.src = 'https://www.googletagmanager.com/gtag/js?id=' + ga;
  later(() => document.head.appendChild(g));

  // Microsoft Clarity (heatmaps and replays)
  window.clarity = window.clarity || function () { (window.clarity.q = window.clarity.q || []).push(arguments); }; // queue until it loads
  const startClarity = () => {
    const t = document.createElement('script'); t.async = true; t.src = 'https://www.clarity.ms/tag/' + window.RR_ANALYTICS.clarity;
    document.head.appendChild(t);
  };
  later(startClarity);
})();
