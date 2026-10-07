// Right Ride visit counting with GoatCounter (no cookies, no personal data).
// Set the site code below once a GoatCounter account exists (e.g. "rightride" for rightride.goatcounter.com).
window.RR_ANALYTICS = { goatcounter: 'rightride' };
(function () {
  const code = /^(www\.)?rightride\.in$/.test(location.hostname) ? window.RR_ANALYTICS.goatcounter : '';
  const q = [];
  // rr.track(path, title, isEvent): queued until GoatCounter's script has loaded
  window.rrTrack = function (path, title, event) {
    if (!code) return;
    const hit = { path, title: title || path, event: !!event };
    if (window.goatcounter && window.goatcounter.count) window.goatcounter.count(hit); else q.push(hit);
  };
  if (document.currentScript && document.currentScript.hasAttribute('data-admin')) return; // the admin page reads stats, it isn't counted
  // Only count visits on the live domain (not aksreedevi.in, previews or localhost)
  if (!code || !/^(www\.)?rightride\.in$/.test(location.hostname)) return;
  window.goatcounter = { no_onload: true, allow_local: false };
  const s = document.createElement('script');
  s.async = true; s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = `https://${code}.goatcounter.com/count`;
  s.onload = () => { while (q.length) window.goatcounter.count(q.shift()); };
  document.head.appendChild(s);
})();
