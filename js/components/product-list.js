import { escapeHTML } from '../utils/validators.js';

const imageURLsByContainer = new WeakMap();

export function renderProductList(container, products) {
  for (const url of imageURLsByContainer.get(container) || []) URL.revokeObjectURL(url);
  const activeImageURLs = new Set();
  imageURLsByContainer.set(container, activeImageURLs);
  container.replaceChildren();
  for (const product of products) {
    const card = document.createElement('article');
    card.className = 'product-card';
    const imageURL = product.image ? URL.createObjectURL(product.image) : 'assets/placeholders/product.svg';
    if (product.image) activeImageURLs.add(imageURL);
    card.innerHTML = `
      <div class="product-card__image"><img src="${imageURL}" alt="${escapeHTML(product.title)}" loading="lazy">${product.image && product.imageCredit?.illustrative ? '<span class="image-illustrative-label">Foto ilustrativa</span>' : ''}</div>
      <div class="product-card__body">
        <h3>${escapeHTML(product.title)}</h3>
        <p>${escapeHTML(product.brand || 'Sin marca')}</p>
        <div class="product-card__actions">
          <button class="text-button" type="button" data-product-action="edit" data-product-id="${escapeHTML(product.id)}">Editar</button>
          <button class="text-button text-button--danger" type="button" data-product-action="delete" data-product-id="${escapeHTML(product.id)}">Eliminar</button>
        </div>
      </div>`;
    container.append(card);
  }
}
