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
const VERSION = '146205d2441e';
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
  /* ⭐ The install is ATOMIC: if any entry fails the whole install fails and the OLD worker keeps
     serving. That is the behaviour we want — a half-cached shell is a blank screen.
     ⛔⛔ ROUND 4: AND IT MUST CACHE THE PAGE OF *THIS* BUILD. `addAll(SHELL)` fetched `./` with the default
     cache mode, so the browser or the Fastly edge (`max-age=600`) could hand the NEW worker the OLD page,
     and that is what the freezer would then open offline. ⭐ So the page is fetched as `./?v=<VERSION>`
     (a URL the CDN has never cached) with `cache:'reload'`, and the install FAILS unless the body carries
     this worker's own stamp (`let BUILD = '<VERSION>'`) — the old worker keeps serving and the page's next
     version check retries. Stored under `./` and `./index.html`; the decoder the same way. */
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    const page = await fetch('./?v=' + VERSION, {cache: 'reload'});
    if (!page || !page.ok) throw new Error('shell page fetch failed');
    const a = page.clone(), b = page.clone();
    const txt = await page.text();
    if (txt.indexOf("let BUILD = '" + VERSION + "'") < 0)
      throw new Error('the page served is not build ' + VERSION + ' yet — not installing');
    await c.put('./', a);
    await c.put('./index.html', b);
    const zx = await fetch('./zxing.js?v=' + VERSION, {cache: 'reload'});
    if (!zx || !zx.ok) throw new Error('zxing.js fetch failed');
    await c.put('./zxing.js', zx);
  })().then(() => self.skipWaiting()));
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

  /* ⛔⛔ ROUND 3 (A0): `version.json` IS HOW A PAGE LEARNS A NEWER BUILD IS DEPLOYED, so it is never cached
     and never answered from a cache — a stale answer would say "nothing new" for ever. The page asks with
     a cache-busting query and `cache:'no-store'`; this keeps the worker out of the way entirely. */
  if (/version\.json$/i.test(url.pathname)) return;

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
  /* ⛔⛔ ROUND 3 (A0): NETWORK-FIRST MUST REALLY BE NETWORK-FIRST. A plain `fetch(req)` goes through the
     browser HTTP cache, and GitHub Pages sends `max-age=600` — so for up to ten minutes after a push the
     "network" answer was the old page. ⭐ The page itself (a navigation, `./`, `index.html`) is fetched
     with `cache:'no-cache'` — revalidated with the server every time — and a redirected answer falls back
     to the plain fetch (a navigation may not be answered with a redirected response). */
  const isPage = req.mode === 'navigate' || /\/(index\.html)?$/i.test(url.pathname);
  e.respondWith((async () => {
    try {
      let fresh = null;
      if (isPage) {
        fresh = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
        if (fresh && fresh.redirected) fresh = await fetch(req);
      } else {
        fresh = await fetch(req);
      }
      /* ⛔⛔ ROUND 4 RE-CHECK: THE ONLINE PATH MUST NOT UNDO THE INSTALL'S CHECK. `cache:'no-cache'` gets
         past the browser cache, not the Fastly edge — so for ~10 min after a push a launch at the desk can
         be answered with the PREVIOUS page, and storing it overwrote the verified copy the freezer opens
         offline. ⭐ A page is stored only if it carries THIS worker's own build, and only under the two
         canonical keys the offline path reads; anything else is shown but not kept. The decoder was verified
         at install and is never overwritten at run time. */
      if (fresh && fresh.status === 200 && fresh.type === 'basic') {
        const c = await caches.open(CACHE);
        if (isPage) {
          const txt = await fresh.clone().text();
          if (txt.indexOf("let BUILD = '" + VERSION + "'") >= 0) {
            const hdr = { headers: { 'Content-Type': 'text/html; charset=utf-8' } };
            await c.put('./', new Response(txt, hdr));
            await c.put('./index.html', new Response(txt, hdr));
          }
        } else if (!/\/zxing\.js$/i.test(url.pathname)) {
          c.put(req, fresh.clone());
        }
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
