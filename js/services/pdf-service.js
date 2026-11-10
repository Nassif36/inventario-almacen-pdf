import { escapeHTML } from '../utils/validators.js';
import { APP_CONFIG } from '../config.js';
import { catalogFilename } from '../utils/catalog-filename.js';

const ORDER_STEPS = [
  { title: 'Vos pedís', icon: 'order-request' },
  { title: 'Nosotros lo preparamos', icon: 'order-prepare' },
  { title: 'Lo cargamos', icon: 'order-load' },
  { title: 'Te lo llevamos', icon: 'order-deliver' }
];

// Vivid accents dark enough for bold white text; shared by the screen, print and PDF catalogs.
export const CATEGORY_ACCENTS = ['#e8590c', '#d6336c', '#1c7ed6', '#2f9e44', '#7048e8', '#0c8599'];

export function tintColor(hex, amount = 0.12) {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return `#${channels.map((value) => Math.round(255 - (255 - value) * amount).toString(16).padStart(2, '0')).join('')}`;
}

const STRIPE = CATEGORY_ACCENTS.map((color) => `<span style="background: ${color}"></span>`).join('');

export function renderCatalog(container, products, categories, logoBlob) {
  for (const url of container.dataset.objectURLs?.split('|') || []) {
    if (url) URL.revokeObjectURL(url);
  }
  const objectURLs = [];
  const logo = logoBlob ? URL.createObjectURL(logoBlob) : 'assets/products/logo_transparent.png';
  if (logoBlob) objectURLs.push(logo);
  const grouped = categories
    .map((category) => ({
      name: category.name,
      products: products.filter((product) => product.category === category.name)
    }))
    .filter((category) => category.products.length);
  container.classList.toggle('catalog-content--spacious', products.length <= 10);
  const { address, whatsapp } = APP_CONFIG.catalogContact;
  const whatsappURL = `https://wa.me/${whatsapp.replace(/\D/g, '')}`;
  const locationURL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

  const steps = ORDER_STEPS.map((step, index) =>
    `<li><img class="order-step__illustration" src="assets/icons/${step.icon}.svg" alt=""><span class="order-step__caption"><span class="order-step__number">${index + 1}</span><span class="order-step__title">${step.title}</span></span></li>`
  ).join('');
  const groups = grouped.map((category, categoryIndex) => {
    const accent = CATEGORY_ACCENTS[categoryIndex % CATEGORY_ACCENTS.length];
    return `
    <section class="catalog-category" data-accent="${accent}" style="--accent: ${accent}; --accent-tint: ${tintColor(accent)}">
      <h2 class="catalog-category__title"><span></span>${escapeHTML(category.name)}<img class="catalog-category__icon" src="assets/icons/category-sparkle.svg" alt=""><span></span></h2>
      <div class="catalog-grid">
        ${category.products.map((product) => {
          const image = product.image ? URL.createObjectURL(product.image) : 'assets/placeholders/product.svg';
          if (product.image) objectURLs.push(image);
          return `<article class="catalog-product">
            <div class="catalog-product__image"><img src="${image}" alt="${escapeHTML(product.title)}">${product.image && product.imageCredit?.illustrative ? '<span class="image-illustrative-label">Foto ilustrativa</span>' : ''}<h3>${escapeHTML(product.title)}</h3></div>
          </article>`;
        }).join('')}
      </div>
    </section>`;
  }).join('');

  container.innerHTML = `
    <div class="catalog-stripe" aria-hidden="true">${STRIPE}</div>
    <header class="catalog-header">
      <div class="catalog-header__identity">
        <img class="catalog-logo" src="${logo}" alt="Logo de El Hornero Market">
        <div><p class="catalog-kicker">EL HORNERO MARKET</p><p class="catalog-header__tagline">Calidad para compartir.</p></div>
      </div>
      <address class="catalog-contact" aria-label="Contacto de El Hornero Market">
        <a class="catalog-contact__item" href="${locationURL}" target="_blank" rel="noopener noreferrer" aria-label="Ubicación: ${escapeHTML(address)}"><img src="assets/icons/location-pin.svg" alt=""><span>${escapeHTML(address)}</span></a>
        <a class="catalog-contact__item" href="${whatsappURL}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp: ${escapeHTML(whatsapp)}"><img src="assets/icons/whatsapp.svg" alt=""><span>${escapeHTML(whatsapp)}</span></a>
      </address>
    </header>
    <ol class="order-steps" aria-label="Cómo hacer tu pedido">${steps}</ol>
    <div class="catalog-intro"><img class="cart-icon" src="assets/icons/cart.svg" alt=""><h1>Listado de productos: </h1></div>
    ${groups || '<p class="catalog-empty">Todavía no hay productos para mostrar.</p>'}
    <div class="catalog-stripe catalog-stripe--bottom" aria-hidden="true">${STRIPE}</div>`;
  container.dataset.objectURLs = objectURLs.join('|');
}

export async function printCatalog() {
  await waitForCatalogImages(document.querySelector('#catalog-content'));
  if (document.fonts?.ready) await document.fonts.ready;
  const originalTitle = document.title;
  const restoreTitle = () => {
    document.title = originalTitle;
    window.removeEventListener('afterprint', restoreTitle);
  };
  document.title = catalogFilename();
  window.addEventListener('afterprint', restoreTitle, { once: true });
  try {
    window.print();
  } catch (error) {
    restoreTitle();
    throw error;
  }
}

export async function waitForCatalogImages(container) {
  await Promise.all([...container.querySelectorAll('img')].map(async (image) => {
    try {
      await image.decode();
    } catch {
      throw new Error(`No se pudo cargar la imagen "${image.alt || image.getAttribute('src')}". Revisá el producto antes de exportar.`);
    }
  }));
}

export function preparePrintCatalog() {
  const root = document.querySelector('#print-root');
  const catalog = document.querySelector('#catalog-content').cloneNode(true);
  catalog.removeAttribute('id');
  delete catalog.dataset.objectURLs;
  root.replaceChildren(catalog);
}
