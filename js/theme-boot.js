// Theme before first paint (DESIGN §2.1). A tiny CLASSIC script loaded
// synchronously in <head> (an external file, because the CSP forbids inline
// scripts). Module scripts are deferred, so without this a 3 am visit could
// flash the light oat background before js/app.js runs.
//
// It reads the per-device copies app.js keeps in localStorage (the real
// settings live in IndexedDB, which can't be read synchronously):
//   nurture.themePref  'auto' | 'light' | 'dark'   (the user's choice)
//   nurture.motion     'reduce' | 'full' | ''      (in-app Reduce motion)
// and resolves 'auto' exactly like app.js: dark when the system is dark OR
// during night hours (19:00–08:00). app.js re-applies the real settings once
// IndexedDB is open, so a stale or missing cache only affects one frame.
(function () {
  var root = document.documentElement;
  function read(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  var pref = read('nurture.themePref');
  var theme = pref === 'light' || pref === 'dark' ? pref : null;
  if (!theme) {
    var h = new Date().getHours();
    var sysDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    theme = sysDark || h >= 19 || h < 8 ? 'dark' : 'light';
  }
  root.setAttribute('data-theme', theme);
  // Status bar = --bg of the theme actually shown (the metas sit above us).
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i += 1) metas[i].setAttribute('content', theme === 'dark' ? '#191512' : '#F6F1E8');
  var motion = read('nurture.motion');
  if (motion === 'reduce' || motion === 'full') root.setAttribute('data-motion', motion);
}());
