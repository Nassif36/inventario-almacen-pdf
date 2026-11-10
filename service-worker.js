const CACHE_NAME = 'hornero-shell-v14';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/main.css',
  './css/admin.css',
  './css/catalog.css',
  './css/print.css',
  './js/app.js',
  './js/config.js',
  './js/database/db.js',
  './js/utils/validators.js',
  './js/utils/formatters.js',
  './js/utils/catalog-filename.js',
  './js/services/product-service.js',
  './js/services/category-service.js',
  './js/services/csv-import-service.js',
  './js/services/backup-service.js',
  './js/services/default-inventory-service.js',
  './js/services/settings-service.js',
  './js/services/pdf-service.js',
  './js/services/pdf-download-service.js',
  './js/vendor/jspdf.umd.min.js',
  './js/vendor/jspdf-LICENSE.txt',
  './js/components/product-form.js',
  './js/components/product-list.js',
  './js/components/category-manager.js',
  './js/components/csv-importer.js',
  './assets/icons/hornero.svg',
  './assets/products/logo_transparent.png',
  './assets/icons/order-request.svg',
  './assets/icons/order-prepare.svg',
  './assets/icons/order-load.svg',
  './assets/icons/order-deliver.svg',
  './assets/icons/cart.svg',
  './assets/icons/category-sparkle.svg',
  './assets/fonts/DMSans-Regular.ttf',
  './assets/fonts/DMSans-SemiBold.ttf',
  './assets/fonts/DMSans-Bold.ttf',
  './assets/fonts/PlayfairDisplay-Bold.ttf',
  './assets/fonts/DMSans-OFL.txt',
  './assets/fonts/PlayfairDisplay-OFL.txt',
  './assets/icons/location-pin.svg',
  './assets/icons/whatsapp.svg',
  './assets/icons/fontawesome-LICENSE.txt',
  './assets/placeholders/product.svg',
  './assets/products/coca-cola-original.jpg',
  './assets/products/agua-cristaline.jpg',
  './assets/products/barilla-spaghetti-5.jpg',
  './assets/products/nutella.jpg',
  './assets/products/ATTRIBUTION.txt',
  './inventario/inventario-el-hornero.csv',
  './inventario/respaldo-el-hornero.json',
  './inventario/actualizacion-fotografias.json',
  './inventario/catalogo-el-hornero.pdf',
  './inventario/catalogo-el-hornero-continuo.pdf',
  './inventario/atribuciones-imagenes.txt',
  './inventario/busqueda-fotografias.txt',
  './inventario/pendientes-imagenes.csv',
  './inventario/LEEME.txt',
  './inventario/manifest-imagenes.json'
];
const CDN_FILES = [
  'https://cdn.jsdelivr.net/npm/dexie@4.0.11/dist/dexie.min.js',
  'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_FILES);
    const imageManifest = await cache.match('./inventario/manifest-imagenes.json');
    const imagePaths = await imageManifest.json();
    if (!Array.isArray(imagePaths) || imagePaths.some((path) => typeof path !== 'string' || !path.startsWith('./inventario/imagenes/'))) {
      throw new Error('El manifiesto de imágenes del inventario no es válido.');
    }
    await cache.addAll(imagePaths);
    for (const url of CDN_FILES) {
      try {
        const response = await fetch(url);
        if (response.ok) await cache.put(url, response);
      } catch (error) {
        console.warn(`No se pudo guardar una dependencia para uso sin conexión: ${url}`, error);
      }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('hornero-shell-') && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestURL = new URL(event.request.url);
  if (requestURL.origin === self.location.origin) {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, response.clone());
        }
        return response;
      } catch {
        return (await caches.match(event.request)) ||
          (event.request.mode === 'navigate' ? await caches.match('./index.html') : null) ||
          Response.error();
      }
    })());
    return;
  }

  if (requestURL.host === 'cdn.jsdelivr.net') {
    event.respondWith((async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok && CDN_FILES.includes(event.request.url)) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
      }
      return response;
    })());
  }
});
