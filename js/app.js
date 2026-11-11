import { APP_CONFIG } from './config.js';
import { initializeDatabase } from './database/db.js';
import { openProductForm } from './components/product-form.js';
import { renderProductList } from './components/product-list.js';
import { renderCategoryManager } from './components/category-manager.js';
import { openCSVImporter } from './components/csv-importer.js';
import { deleteCategory, listCategories, saveCategory } from './services/category-service.js';
import { retrieveProductImage } from './services/csv-import-service.js';
import { createBackup, restoreBackup, validateBackup } from './services/backup-service.js';
import { attachKnownImageCredits, initializeDefaultInventory, loadDefaultInventory } from './services/default-inventory-service.js';
import { listProducts, saveProduct, deleteProduct, importProducts } from './services/product-service.js';
import { preparePrintCatalog, printCatalog, renderCatalog } from './services/pdf-service.js';
import { downloadCatalogPDF } from './services/pdf-download-service.js';
import { getSetting, setSetting } from './services/settings-service.js';
import { escapeHTML, normalizeKey, normalizeWhatsAppNumber, validateImage } from './utils/validators.js';
import { formatDate, pluralize } from './utils/formatters.js';

const state = { products: [], categories: [], currentView: 'dashboard' };
const statusMessage = document.querySelector('#database-status');
const statusLabel = document.querySelector('#storage-label');
const statusCard = document.querySelector('.storage-card');
const productDialog = document.querySelector('#product-dialog');

async function startApplication() {
  try {
    await initializeDatabase();
    try {
      const inventory = await initializeDefaultInventory();
      const hasExistingData = inventory.state === 'existing';
      document.querySelector('[data-action="load-default-inventory"]').hidden = !hasExistingData;
      statusMessage.textContent = hasExistingData
        ? 'Tus datos anteriores se conservaron. Podés agregar el inventario validado sin sobrescribirlos.'
        : inventory.photosUpdated
          ? `Se ${inventory.photosUpdated === 1 ? 'agregó' : 'agregaron'} ${pluralize(inventory.photosUpdated, 'foto nueva', 'fotos nuevas')} sin modificar tus datos.`
          : 'El almacenamiento local está listo. Tus datos permanecerán en este dispositivo.';
      statusLabel.textContent = 'LISTO';
      statusCard.classList.add('storage-card--ready');
    } catch (error) {
      console.error('No se pudo preparar el inventario inicial.', error);
      statusMessage.textContent = `No se pudo preparar el inventario inicial: ${error.message} Tus datos existentes se conservan; recargá para reintentar.`;
      statusLabel.textContent = 'ERROR';
      statusCard.classList.add('storage-card--error');
    }
    await refreshData();
    activateView(location.hash.slice(1) || 'dashboard');
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('./service-worker.js').catch((error) => {
        console.error('No se pudo registrar el modo sin conexión.', error);
      });
    }
  } catch (error) {
    console.error('No se pudo inicializar la aplicación.', error);
    statusMessage.textContent = 'No pudimos iniciar el almacenamiento local. Revisá que tu navegador permita guardar datos y recargá la página.';
    statusLabel.textContent = 'ERROR';
    statusCard.classList.add('storage-card--error');
  }
}

async function refreshData() {
  [state.products, state.categories] = await Promise.all([listProducts(), listCategories()]);
  renderStats();
  renderProducts();
  renderCategories();
  await refreshCatalog();
}

function renderStats() {
  document.querySelector('#stat-products').textContent = state.products.length;
  document.querySelector('#stat-categories').textContent = state.categories.length;
  document.querySelector('#stat-brands').textContent = new Set(
    state.products.map((product) => normalizeKey(product.brand)).filter(Boolean)
  ).size;
  const recent = [...state.products]
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    .slice(0, 3);
  renderProductList(document.querySelector('#recent-products'), recent);
}

function renderProducts() {
  const categoryFilter = document.querySelector('#category-filter');
  const brandFilter = document.querySelector('#brand-filter');
  const selectedCategory = categoryFilter.value;
  const selectedBrand = brandFilter.value;
  categoryFilter.innerHTML = '<option value="">Todas las categorías</option>' +
    state.categories.map((category) => `<option value="${escapeHTML(category.name)}">${escapeHTML(category.name)}</option>`).join('');
  brandFilter.innerHTML = '<option value="">Todas las marcas</option>' +
    [...new Set(state.products.map((product) => product.brand).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'es'))
      .map((brand) => `<option value="${escapeHTML(brand)}">${escapeHTML(brand)}</option>`).join('');
  categoryFilter.value = selectedCategory;
  brandFilter.value = selectedBrand;
  applyProductFilters();
}

function applyProductFilters() {
  const search = normalizeKey(document.querySelector('#product-search').value);
  const category = document.querySelector('#category-filter').value;
  const brand = document.querySelector('#brand-filter').value;
  const sort = document.querySelector('#product-sort').value;
  const products = state.products.filter((product) =>
    (!category || product.category === category) &&
    (!brand || product.brand === brand) &&
    (!search || normalizeKey(`${product.title} ${product.brand}`).includes(search))
  );
  products.sort(sort === 'newest'
    ? (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    : (a, b) => a.title.localeCompare(b.title, 'es'));
  renderProductList(document.querySelector('#product-list'), products);
  document.querySelector('#product-empty').hidden = products.length > 0;
}

function renderCategories() {
  renderCategoryManager(document.querySelector('#category-list'), state.categories, state.products);
}

function activateView(name) {
  const panel = document.querySelector(`[data-panel="${CSS.escape(name)}"]`);
  if (!panel) name = 'dashboard';
  state.currentView = name;
  document.querySelectorAll('[data-panel]').forEach((item) => { item.hidden = item.dataset.panel !== name; });
  document.querySelectorAll('#main-navigation [data-view]').forEach((item) => {
    const active = item.dataset.view === name;
    item.classList.toggle('navigation__item--active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  const labels = { dashboard: 'Resumen', products: 'Productos', categories: 'Categorías', catalog: 'Catálogo PDF' };
  document.querySelector('#current-page').textContent = labels[name] || labels.dashboard;
  if (name === 'catalog') refreshCatalog().catch(reportError);
}

async function refreshCatalog() {
  const [logo, whatsapp] = await Promise.all([
    getSetting('catalogLogo'),
    getSetting('catalogWhatsapp')
  ]);
  renderCatalog(document.querySelector('#catalog-content'), state.products, state.categories, logo, whatsapp || undefined);
}

function openNewProduct() {
  openProductForm({
    dialog: productDialog,
    product: null,
    categories: state.categories,
    onSave: saveProductAndRefresh,
    onCreateCategory: async (name) => {
      const category = await saveCategory(name);
      await refreshData();
      return category;
    }
  });
}

function openEditProduct(id) {
  const product = state.products.find((item) => item.id === id);
  if (!product) return;
  openProductForm({
    dialog: productDialog,
    product,
    categories: state.categories,
    onSave: saveProductAndRefresh,
    onCreateCategory: async (name) => {
      const category = await saveCategory(name);
      await refreshData();
      return category;
    }
  });
}

async function saveProductAndRefresh(product) {
  await saveProduct(product);
  await refreshData();
}

function openCategoryDelete(category) {
  const dialog = document.querySelector('#category-delete-dialog');
  const products = state.products.filter((product) => product.category === category.name);
  const targets = state.categories.filter((item) => item.id !== category.id);
  dialog.innerHTML = `
    <form class="dialog-form" id="category-delete-form">
      <div class="dialog-heading"><div><p class="eyebrow">GESTIÓN DE CATEGORÍAS</p><h2 id="category-delete-title">Eliminar categoría</h2></div><button class="icon-button" type="button" data-dialog-close aria-label="Cerrar">×</button></div>
      <p class="dialog-description">Vas a eliminar <strong>${escapeHTML(category.name)}</strong>. ${products.length ? `Tiene ${pluralize(products.length, 'producto', 'productos')}. Elegí qué hacer con ellos:` : 'No tiene productos asignados.'}</p>
      ${products.length ? `<div class="backup-mode">
        ${targets.length ? `<label><input type="radio" name="strategy" value="reassign" checked> Reasignar productos a <select name="target">${targets.map((target) => `<option value="${escapeHTML(target.id)}">${escapeHTML(target.name)}</option>`).join('')}</select></label>` : ''}
        <label><input type="radio" name="strategy" value="delete" ${targets.length ? '' : 'required'}> Eliminar también los ${products.length} productos asociados</label>
      </div>` : ''}
      <p class="form-message" role="alert"></p>
      <div class="dialog-actions"><button class="button button--quiet" type="button" data-dialog-close>Cancelar</button><button class="button button--danger" type="submit">Eliminar categoría</button></div>
    </form>`;
  const form = dialog.querySelector('form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const strategyValue = form.elements.strategy?.value;
    const strategy = products.length
      ? strategyValue === 'reassign'
        ? { reassignTo: form.elements.target.value }
        : strategyValue === 'delete' ? { deleteProducts: true } : null
      : {};
    if (!strategy) {
      form.querySelector('.form-message').textContent = 'Elegí reasignar o eliminar los productos asociados.';
      return;
    }
    if (strategy.deleteProducts && !window.confirm(`Se eliminarán ${products.length} productos de forma permanente. ¿Querés continuar?`)) return;
    try {
      await deleteCategory(category.id, strategy);
      dialog.close();
      await refreshData();
    } catch (error) {
      form.querySelector('.form-message').textContent = error.message;
    }
  });
  dialog.querySelectorAll('[data-dialog-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.showModal();
}

async function performCSVImport(products) {
  const imageErrors = [];
  const prepared = [];
  for (const product of products) {
    const result = await retrieveProductImage(product.imageURL);
    if (result.error) imageErrors.push(`Fila "${product.title}": ${result.error}`);
    prepared.push({ ...product, image: result.image });
  }
  await importProducts(prepared);
  await refreshData();
  return { imported: prepared.length, imageErrors };
}

async function exportBackup() {
  const backup = await createBackup();
  downloadFile(
    new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
    `el-hornero-respaldo-${new Date().toISOString().slice(0, 10)}.json`
  );
}

function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openBackupImport() {
  const dialog = document.querySelector('#backup-dialog');
  dialog.innerHTML = `
    <div class="dialog-form">
      <div class="dialog-heading"><div><p class="eyebrow">DATOS DEL CATÁLOGO</p><h2 id="backup-dialog-title">Restaurar respaldo</h2></div><button class="icon-button" type="button" data-dialog-close aria-label="Cerrar">×</button></div>
      <p class="dialog-description">Elegí un archivo de respaldo JSON. Antes de restaurarlo podrás revisar su contenido y elegir cómo combinarlo con tus datos actuales.</p>
      <label class="upload-field">Archivo de respaldo <input id="backup-dialog-file" type="file" accept="application/json,.json"><span>El respaldo incluye categorías, productos e imágenes.</span></label>
      <div id="backup-preview"></div><p class="form-message" id="backup-message" role="alert"></p>
      <div class="dialog-actions"><button class="button button--quiet" type="button" data-dialog-close>Cancelar</button></div>
    </div>`;
  const preview = dialog.querySelector('#backup-preview');
  const message = dialog.querySelector('#backup-message');
  dialog.querySelector('#backup-dialog-file').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      const counts = validateBackup(backup);
      preview.innerHTML = `
        <div class="backup-preview"><strong>Respaldo válido</strong><br>${pluralize(counts.products, 'producto', 'productos')} · ${pluralize(counts.categories, 'categoría', 'categorías')}<br>Exportado: ${escapeHTML(formatDate(backup.exportedAt))}</div>
        <div class="backup-mode">
          <label><input type="radio" name="restore-mode" value="merge" checked> Combinar: conservar los datos actuales y agregar los del respaldo.</label>
          <label><input type="radio" name="restore-mode" value="replace"> Reemplazar: borrar los datos actuales y restaurar este respaldo.</label>
        </div>`;
      const restoreButton = document.createElement('button');
      restoreButton.className = 'button button--primary';
      restoreButton.type = 'button';
      restoreButton.textContent = 'Restaurar respaldo';
      dialog.querySelector('.dialog-actions').prepend(restoreButton);
      restoreButton.addEventListener('click', async () => {
        const mode = dialog.querySelector('[name="restore-mode"]:checked')?.value;
        if (mode === 'replace' && !window.confirm('Esta acción reemplazará todos los productos, categorías y ajustes guardados en este dispositivo. ¿Querés continuar?')) return;
        restoreButton.disabled = true;
        try {
          const result = await restoreBackup(backup, mode);
          await attachKnownImageCredits(true);
          await refreshData();
          if (mode === 'replace') document.querySelector('[data-action="load-default-inventory"]').hidden = true;
          message.textContent = `Respaldo restaurado: se agregaron ${pluralize(result.products, 'producto', 'productos')} y ${pluralize(result.categories, 'categoría', 'categorías')}.${result.skippedProducts ? ` Se omitieron ${pluralize(result.skippedProducts, 'producto', 'productos')} que ya existen para evitar duplicados o sobrescrituras.` : ''}`;
          restoreButton.remove();
          const done = document.createElement('button');
          done.className = 'button button--quiet';
          done.type = 'button';
          done.textContent = 'Cerrar';
          done.addEventListener('click', () => dialog.close());
          dialog.querySelector('.dialog-actions').prepend(done);
        } catch (error) {
          message.textContent = error.message;
          restoreButton.disabled = false;
        }
      });
      message.textContent = '';
    } catch (error) {
      preview.replaceChildren();
      message.textContent = error.message;
    }
  });
  dialog.querySelectorAll('[data-dialog-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.showModal();
}

async function openLogoSettings() {
  const dialog = document.querySelector('#logo-dialog');
  const logo = await getSetting('catalogLogo');
  const logoURL = logo ? URL.createObjectURL(logo) : null;
  dialog.innerHTML = `
    <form class="dialog-form" id="logo-form">
      <div class="dialog-heading"><div><p class="eyebrow">IDENTIDAD DEL CATÁLOGO</p><h2 id="logo-dialog-title">Configurar logo</h2></div><button class="icon-button" type="button" data-dialog-close aria-label="Cerrar">×</button></div>
      <p class="dialog-description">Este logo aparecerá en el encabezado del catálogo imprimible. Si no elegís uno, usaremos el logo de El Hornero Market.</p>
      ${logoURL ? `<img class="logo-preview" src="${logoURL}" alt="Logo actual">` : '<p class="logo-default-note">Se está usando el logo predeterminado.</p>'}
      <label class="upload-field">Elegir imagen <input name="logo" type="file" accept="image/jpeg,image/png,image/webp"><span>JPG, PNG o WebP · Máximo 5 MB</span></label>
      ${logoURL ? '<label class="check-field"><input name="removeLogo" type="checkbox"> Volver al logo predeterminado</label>' : ''}
      <p class="form-message" role="alert"></p><div class="dialog-actions"><button class="button button--quiet" type="button" data-dialog-close>Cancelar</button><button class="button button--primary" type="submit">Guardar logo</button></div>
    </form>`;
  const form = dialog.querySelector('#logo-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = form.elements.logo.files[0];
    try {
      if (file) validateImage(file);
      if (form.elements.removeLogo?.checked) await setSetting('catalogLogo', null);
      else if (file) await setSetting('catalogLogo', file);
      await refreshCatalog();
      dialog.close();
    } catch (error) {
      form.querySelector('.form-message').textContent = error.message;
    }
  });
  dialog.querySelectorAll('[data-dialog-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', () => { if (logoURL) URL.revokeObjectURL(logoURL); }, { once: true });
  dialog.showModal();
}

async function openWhatsAppSettings() {
  const dialog = document.querySelector('#whatsapp-dialog');
  const whatsapp = await getSetting('catalogWhatsapp') || APP_CONFIG.catalogContact.whatsapp;
  dialog.innerHTML = `
    <form class="dialog-form" id="whatsapp-form">
      <div class="dialog-heading"><div><p class="eyebrow">CONTACTO DEL CATÁLOGO</p><h2 id="whatsapp-dialog-title">Configurar WhatsApp</h2></div><button class="icon-button" type="button" data-dialog-close aria-label="Cerrar">×</button></div>
      <p class="dialog-description">Este número aparecerá en el catálogo y será el destino del enlace de WhatsApp. Incluí el código de país.</p>
      <label>Número de WhatsApp <input name="whatsapp" type="tel" inputmode="tel" autocomplete="tel" maxlength="32" value="${escapeHTML(whatsapp)}" placeholder="+54 9 11 1234-5678" required><span>Ejemplo: +54 9 11 1234-5678</span></label>
      <p class="form-message" role="alert"></p><div class="dialog-actions"><button class="button button--quiet" type="button" data-dialog-close>Cancelar</button><button class="button button--primary" type="submit">Guardar WhatsApp</button></div>
    </form>`;
  const form = dialog.querySelector('#whatsapp-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await setSetting('catalogWhatsapp', normalizeWhatsAppNumber(form.elements.whatsapp.value));
      await refreshCatalog();
      dialog.close();
    } catch (error) {
      form.querySelector('.form-message').textContent = error.message;
    }
  });
  dialog.querySelectorAll('[data-dialog-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.showModal();
}

function reportError(error) {
  console.error(error);
  window.alert(error.message || 'Ocurrió un error inesperado.');
}

document.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-action], [data-product-action], [data-category-delete]');
  if (!action) return;
  if (action.hasAttribute('data-dialog-close')) {
    action.closest('dialog').close();
    return;
  }

  try {
    if (action.dataset.action === 'add-product') openNewProduct();
    else if (action.dataset.action === 'load-default-inventory') {
      if (!window.confirm('Se agregarán los productos faltantes y se completarán fotos ausentes en productos que coincidan exactamente. No se sobrescribirán tus datos ni tus fotos actuales. ¿Querés continuar?')) return;
      action.disabled = true;
      try {
        const result = await loadDefaultInventory();
        await refreshData();
        action.hidden = true;
        statusMessage.textContent = result.alreadyInitialized
          ? 'El inventario inicial ya fue preparado en este dispositivo.'
          : `Inventario preparado: se ${result.products === 1 ? 'agregó' : 'agregaron'} ${pluralize(result.products, 'producto', 'productos')} y se ${result.imagesUpdated === 1 ? 'completó' : 'completaron'} ${pluralize(result.imagesUpdated, 'foto', 'fotos')} sin sobrescribir tus datos.`;
      } finally {
        action.disabled = false;
      }
    }
    else if (action.dataset.action === 'import-csv') {
      openCSVImporter({ dialog: document.querySelector('#csv-dialog'), onImport: performCSVImport });
    } else if (action.dataset.action === 'export-pdf' || action.dataset.action === 'export-pdf-continuous') {
      const originalLabel = action.textContent;
      action.disabled = true;
      action.textContent = 'Preparando PDF…';
      action.setAttribute('aria-busy', 'true');
      try {
        await refreshCatalog();
        const format = action.dataset.action === 'export-pdf-continuous' ? 'continuous' : 'a4';
        await downloadCatalogPDF(document.querySelector('#catalog-content'), format);
      } finally {
        action.disabled = false;
        action.textContent = originalLabel;
        action.removeAttribute('aria-busy');
      }
    } else if (action.dataset.action === 'print-catalog') {
      await refreshCatalog();
      await printCatalog();
    } else if (action.dataset.action === 'configure-logo') await openLogoSettings();
    else if (action.dataset.action === 'configure-whatsapp') await openWhatsAppSettings();
    else if (action.dataset.action === 'export-backup') await exportBackup();
    else if (action.dataset.action === 'import-backup') openBackupImport();
    else if (action.dataset.productAction === 'edit') openEditProduct(action.dataset.productId);
    else if (action.dataset.productAction === 'delete') {
      const product = state.products.find((item) => item.id === action.dataset.productId);
      if (product && window.confirm(`¿Querés eliminar "${product.title}"? Esta acción no se puede deshacer.`)) {
        await deleteProduct(product.id);
        await refreshData();
      }
    } else if (action.hasAttribute('data-category-delete')) {
      const row = action.closest('[data-category-id]');
      const category = state.categories.find((item) => item.id === row.dataset.categoryId);
      if (category) openCategoryDelete(category);
    }
  } catch (error) {
    reportError(error);
  }
});

document.addEventListener('submit', async (event) => {
  if (event.target.id === 'category-create-form') {
    event.preventDefault();
    const form = event.target;
    const nameInput = form.elements.name;
    try {
      await saveCategory(nameInput.value);
      nameInput.value = '';
      await refreshData();
    } catch (error) {
      window.alert(error.message);
    }
  } else if (event.target.matches('.category-row')) {
    event.preventDefault();
    const form = event.target;
    try {
      await saveCategory(form.elements.name.value, form.dataset.categoryId);
      await refreshData();
    } catch (error) {
      form.querySelector('.form-message').textContent = error.message;
    }
  }
});

document.querySelector('#product-search').addEventListener('input', applyProductFilters);
document.querySelector('#category-filter').addEventListener('change', applyProductFilters);
document.querySelector('#brand-filter').addEventListener('change', applyProductFilters);
document.querySelector('#product-sort').addEventListener('change', applyProductFilters);
document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
});
window.addEventListener('hashchange', () => activateView(location.hash.slice(1)));
window.addEventListener('beforeprint', preparePrintCatalog);
window.addEventListener('afterprint', () => document.querySelector('#print-root').replaceChildren());

startApplication();
