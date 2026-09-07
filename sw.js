/* Freezer restock — offline shell.  ⛔ CODE ONLY. This service worker must never see, cache
   or store a single unit of plan data.

   ⭐⭐ WHY THIS EXISTS, AND WHY IT IS NOT A CONTRADICTION OF "ONE FILE".
   The one-file rule was about two things: no build step, and no `fetch` for the PLAN — a
   freezer has no signal, so a page that has to download its own data is a page that does not
   open. ⛔ But making the page code-only (the 2026-09-05 public-URL fix) moved the problem
   rather than solving it: the PLAN now survives offline in localStorage, and the PAGE itself
   does not. A crew member who opens the app inside the freezer gets Safari's error screen and
   the cached plan is unreachable behind it.
   ⭐ So: the plan is cached by the app, and the app is cached by this. Both halves offline,
   neither of them public.

   ⛔ WHAT THIS DELIBERATELY DOES NOT TOUCH
   Anything cross-origin — login.microsoftonline.com and graph.microsoft.com above all. An
   auth response served from a cache is either a security hole or a mystifying failure, and
   a token has a lifetime this worker knows nothing about. Same-origin GET, nothing else.  */

/* ⛔ BUMP THIS ON EVERY DEPLOY. A stale service worker serving last week's app forever is
   strictly worse than no service worker, because nothing on screen says so.
   ⭐ deploy_freezer_page.py rewrites it from the built page's own byte length, so it cannot
   be forgotten — see STAMP below. */
const VERSION = 'b8a6a098edf1';
const CACHE = 'freezer-shell-' + VERSION;
/* ⛔⛔ `zxing.js` IS IN THE SHELL, AND THAT IS THE WHOLE POINT OF PRECACHING IT.
   It is the barcode decoder for every device whose browser has none (Safari, i.e. the crew's
   iPad). It is fetched LAZILY by the page — only on the first camera tap — so without this
   line the very first offline camera scan would be the one that fails, in a freezer, having
   worked perfectly at the desk. ⭐ Precaching it at install means it is on the device before
   anyone needs it. ⚠️ `addAll` is atomic, so if this file ever fails to publish the install
   fails loudly and the old worker keeps serving — which is the correct failure. */
const SHELL = ['./', './index.html', './zxing.js'];

self.addEventListener('install', e => {
  /* ⭐ addAll is ATOMIC: if any entry fails the whole install fails and the OLD worker keeps
     serving. That is the behaviour we want — a half-cached shell is a blank screen. */
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                        // ⛔ never a write
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;         // ⛔ never auth, never Graph

  /* ⛔⛔ DEFENCE IN DEPTH: never cache anything plan-shaped, even same-origin. There is no
     payload.json on this origin today — the page is code-only and the plan comes from
     Graph — but the whole 2026-09-05 incident was someone (me) making the page
     self-contained for a good reason and not asking who could read it. If a same-origin
     plan file ever reappears, this worker must not be the thing that quietly persists it
     to a public device cache. */
  if (/payload.*\.json$/i.test(url.pathname)) return;

  /* ⛔⛔ AND THE PKCE REDIRECT LANDS ON THIS ORIGIN CARRYING THE AUTHORIZATION CODE.
     `redirect_uri` is `location.origin + location.pathname` with `response_mode: 'query'`,
     so the navigation back from Microsoft is
     `…/FreezerRestock/?code=<AUTH CODE>&state=…`. The same-origin test above passes it,
     and `c.put(req, …)` would store an entry whose KEY contains the code, in Cache
     Storage, on a shared iPad, until the next deploy changes the cache name.
     ⚠️ The code is single-use, short-lived and PKCE-bound, so this is not an exploitable
     credential on its own — but this file's own rule is "never auth", and that rule was
     only guarding the cross-origin half. `history.replaceState` tidies the address bar
     and does nothing to the cache. */
  if (url.searchParams.has('code') || url.searchParams.has('state') ||
      url.searchParams.has('error')) return;

  /* ⭐ NETWORK FIRST, CACHE AS THE FLOOR. Cache-first would be faster and is the wrong
     trade: the crew sign in warm at the desk, where the network is there, and that is
     exactly the moment a new build must land. Offline, the cache answers. */
  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.status === 200 && fresh.type === 'basic') {
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      /* ⛔ A navigation with nothing cached must not show Safari's error page — it looks
         like the app is broken rather than like the shell was never installed. */
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html', { ignoreSearch: true });
        if (shell) return shell;
        return new Response(
          '<meta name=viewport content="width=device-width,initial-scale=1">' +
          '<div style="font:16px/1.5 system-ui;padding:24px;max-width:32em">' +
          '<h2>Not installed for offline use yet</h2><p>This app has never been opened ' +
          'with a signal, so there is nothing saved on this device. Step out of the ' +
          'freezer, open it once on wifi, and it will work in here from then on.</p></div>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      throw err;
    }
  })());
});
