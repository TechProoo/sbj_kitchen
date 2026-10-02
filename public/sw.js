/*
 * SBJ Kitchen service worker.
 *
 * One job: let the board open with no internet. The page and its scripts are
 * kept on the device, so a screen that is reloaded (or switched on) while the
 * line is down still starts. It never touches the API: those calls are
 * cross-origin and the app handles their failure itself, saving the work to
 * send later.
 */

const VERSION = 'v1';
const SHELL = `sbj-kitchen-shell-${VERSION}`;
const ASSETS = `sbj-kitchen-assets-${VERSION}`;

/// How long to wait for the network before settling for the saved page. A
/// connection that is "up" but not answering must not hold the kitchen hostage.
const NAVIGATE_TIMEOUT_MS = 3500;

/// Same-origin files a page refers to, read out of its HTML.
function assetUrls(html) {
  return [...html.matchAll(/(?:src|href)="(\/[^"/][^"]*)"/g)].map((m) => m[1]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const response = await fetch('/', { cache: 'reload' });
      const html = await response.clone().text();
      await (await caches.open(SHELL)).put('/', response);

      // Fetched now rather than on first use, so the very first visit is
      // already complete enough to survive going offline.
      const assets = await caches.open(ASSETS);
      await Promise.all(
        assetUrls(html).map((url) => assets.add(url).catch(() => undefined)),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, ASSETS]);
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => !keep.has(name)).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/// Built files are named by content hash, so once a new build's page is seen
/// the old build's files can go.
async function prune(html) {
  const wanted = new Set(assetUrls(html));
  const assets = await caches.open(ASSETS);
  const keys = await assets.keys();
  await Promise.all(
    keys
      .filter((request) => {
        const path = new URL(request.url).pathname;
        return path.startsWith('/assets/') && !wanted.has(path);
      })
      .map((request) => assets.delete(request)),
  );
}

async function navigate(request) {
  const shell = await caches.open(SHELL);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NAVIGATE_TIMEOUT_MS);
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);

    // Every route is the same single page.
    if (response.ok) {
      const copy = response.clone();
      await shell.put('/', copy);
      const html = await response.clone().text();
      const assets = await caches.open(ASSETS);
      await Promise.all(
        assetUrls(html).map((url) =>
          assets.match(url).then((hit) => hit || assets.add(url).catch(() => undefined)),
        ),
      );
      void prune(html);
    }
    return response;
  } catch {
    const saved = await shell.match('/');
    if (saved) return saved;
    return new Response('The kitchen board is offline and has not been opened online yet.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

async function assetFirst(request) {
  const assets = await caches.open(ASSETS);
  const hit = await assets.match(request);
  const path = new URL(request.url).pathname;

  // Hashed build files never change under the same name.
  if (hit && path.startsWith('/assets/')) return hit;

  const network = fetch(request)
    .then((response) => {
      if (response.ok) void assets.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);

  // Everything else (logo, manifest) shows what it has and quietly updates.
  if (hit) return hit;
  return (await network) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
    return;
  }

  event.respondWith(assetFirst(request));
});
