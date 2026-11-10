import { escapeHTML } from '../utils/validators.js';
import { pluralize } from '../utils/formatters.js';

export function renderCategoryManager(container, categories, products) {
  const counts = new Map();
  for (const product of products) counts.set(product.category, (counts.get(product.category) || 0) + 1);
  container.replaceChildren();
  if (!categories.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Todavía no hay categorías. Creá una para empezar a organizar tus productos.';
    container.append(empty);
    return;
  }

  for (const category of categories) {
    const row = document.createElement('form');
    row.className = 'category-row';
    row.dataset.categoryId = category.id;
    row.innerHTML = `
      <div class="category-row__name"><span class="category-swatch" aria-hidden="true"></span><input aria-label="Nombre de la categoría" name="name" maxlength="60" required value="${escapeHTML(category.name)}"></div>
      <span class="category-row__count">${pluralize(counts.get(category.name) || 0, 'producto', 'productos')}</span>
      <div class="category-row__actions"><button class="button button--quiet button--small" type="submit">Guardar nombre</button><button class="button button--danger button--small" type="button" data-category-delete>Eliminar</button></div>
      <p class="form-message" role="alert"></p>`;
    container.append(row);
  }
}
