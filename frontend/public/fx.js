/* MyTasker — pick the effects level before first paint. `localStorage.mt_fx = 'low' | 'high'` overrides. */
(function () {
  var root = document.documentElement;
  var level = 'high';
  try {
    var saved = localStorage.getItem('mt_fx');
    if (saved === 'low' || saved === 'high') {
      level = saved;
    } else {
      var nav = navigator;
      var weak =
        (nav.hardwareConcurrency && nav.hardwareConcurrency <= 2) ||
        (nav.deviceMemory && nav.deviceMemory <= 2) ||
        (nav.connection && nav.connection.saveData) ||
        (window.matchMedia && matchMedia('(prefers-reduced-transparency: reduce)').matches);
      if (weak) level = 'low';
    }
  } catch (e) {
    /* private mode: keep the default */
  }
  root.setAttribute('data-fx', level);
})();
