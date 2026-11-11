import { APP_CONFIG } from '../config.js';
import { getDatabase } from '../database/db.js';
import { createId, normalizeImageCredit, normalizeKey, normalizeProductTitle, normalizeWhatsAppNumber, productKey, validateImage } from '../utils/validators.js';

export async function createBackup() {
  const db = getDatabase();
  const [products, categories, logo, whatsapp] = await Promise.all([
    db.products.toArray(),
    db.categories.toArray(),
    db.settings.get('catalogLogo'),
    db.settings.get('catalogWhatsapp')
  ]);
  return {
    application: APP_CONFIG.name,
    schemaVersion: APP_CONFIG.schemaVersion,
    exportedAt: new Date().toISOString(),
    categories,
    products: await Promise.all(products.map(async (product) => ({
      ...product,
      image: product.image ? await blobToDataURL(product.image) : null
    }))),
    logo: logo?.value ? await blobToDataURL(logo.value) : null,
    whatsapp: whatsapp?.value ?? null
  };
}

export function validateBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('El archivo no contiene un respaldo válido.');
  }
  if (data.schemaVersion !== APP_CONFIG.schemaVersion) {
    throw new Error(`Versión de respaldo no compatible: ${data.schemaVersion ?? 'desconocida'}.`);
  }
  if (!Array.isArray(data.categories) || !Array.isArray(data.products)) {
    throw new Error('El respaldo debe incluir listas de productos y categorías.');
  }
  if (data.whatsapp != null) normalizeWhatsAppNumber(data.whatsapp);

  const categoryIDs = new Set();
  const categoryNames = new Set();
  for (const category of data.categories) {
    if (!category || typeof category.id !== 'string' || typeof category.name !== 'string' || !category.name.trim()) {
      throw new Error('El respaldo contiene una categoría inválida.');
    }
    if (categoryIDs.has(category.id)) throw new Error('El respaldo contiene categorías repetidas.');
    const categoryName = normalizeKey(category.name);
    if (categoryNames.has(categoryName)) throw new Error('El respaldo contiene categorías con nombres repetidos.');
    categoryIDs.add(category.id);
    categoryNames.add(categoryName);
  }

  const productIDs = new Set();
  for (const product of data.products) {
    if (!product || typeof product.id !== 'string' || typeof product.title !== 'string' ||
        typeof product.category !== 'string' || !product.title.trim()) {
      throw new Error('El respaldo contiene un producto inválido.');
    }
    if (productIDs.has(product.id)) throw new Error('El respaldo contiene productos repetidos.');
    if (!data.categories.some((category) => normalizeKey(category.name) === normalizeKey(product.category))) {
      throw new Error(`No se encontró la categoría "${product.category}" de un producto.`);
    }
    if (product.imageCredit) {
      if (!product.image) throw new Error('El respaldo contiene una atribución sin imagen.');
      normalizeImageCredit(product.imageCredit);
    }
    productIDs.add(product.id);
  }
  return { products: data.products.length, categories: data.categories.length };
}

export async function restoreBackup(data, mode, options = {}) {
  validateBackup(data);
  if (!['merge', 'replace'].includes(mode)) throw new Error('Elegí cómo querés restaurar el respaldo.');

  const products = await Promise.all(data.products.map(async (source) => ({
    ...source,
    title: normalizeProductTitle(source.title),
    image: source.image ? await dataURLToBlob(source.image) : null,
    imageCredit: source.imageCredit ? normalizeImageCredit(source.imageCredit) : null
  })));
  const logo = data.logo ? await dataURLToBlob(data.logo) : null;
  const db = getDatabase();
  return db.transaction('rw', db.categories, db.products, db.settings, async () => {
    const [currentCategories, currentProducts, currentLogo, currentWhatsapp, inventoryState, inventoryRevision] = await Promise.all([
      db.categories.toArray(),
      db.products.toArray(),
      db.settings.get('catalogLogo'),
      db.settings.get('catalogWhatsapp'),
      db.settings.get(APP_CONFIG.defaultInventoryKey),
      db.settings.get(APP_CONFIG.defaultInventoryRevisionKey)
    ]);
    if (options.allowedInventoryStates && !options.allowedInventoryStates.includes(inventoryState?.value)) {
      return { products: 0, categories: 0, skippedProducts: 0, alreadyInitialized: true };
    }
    if (options.onlyIfInventoryRevisionOutdated && inventoryRevision?.value === APP_CONFIG.defaultInventoryRevision) {
      return { products: 0, categories: 0, skippedProducts: 0, alreadyInitialized: true };
    }
    const categoryMap = new Map();
    const currentByName = new Map(currentCategories.map((item) => [normalizeKey(item.name), item]));
    const idsInUse = new Set(currentCategories.map((item) => item.id));
    const productIDsInUse = new Set(currentProducts.map((item) => item.id));
    const productsByKey = new Map(currentProducts.map((item) => [productKey(item), item]));
    const productKeysInUse = new Set(productsByKey.keys());
    const categoriesToSave = [];

    for (const source of data.categories) {
      let category = mode === 'merge' ? currentByName.get(normalizeKey(source.name)) : null;
      if (!category) {
        category = { ...source };
        if (mode === 'merge' && idsInUse.has(category.id)) category.id = createId();
        idsInUse.add(category.id);
        categoriesToSave.push(category);
        currentByName.set(normalizeKey(category.name), category);
      }
      categoryMap.set(normalizeKey(source.name), category);
    }

    const productsToSave = [];
    const imageUpdates = [];
    let skippedProducts = 0;
    for (const source of products) {
      const product = { ...source, category: categoryMap.get(normalizeKey(source.category)).name };
      const key = productKey(product);
      if (mode === 'merge' && (productIDsInUse.has(product.id) || productKeysInUse.has(key))) {
        const existing = productsByKey.get(key);
        if (options.fillMissingImages && existing && !existing.image && product.image) {
          existing.image = product.image;
          existing.imageCredit = product.imageCredit;
          imageUpdates.push({ id: existing.id, image: product.image, imageCredit: product.imageCredit });
        }
        skippedProducts += 1;
        continue;
      }
      productIDsInUse.add(product.id);
      productKeysInUse.add(key);
      productsToSave.push(product);
    }

    if (mode === 'replace') {
      await db.products.clear();
      await db.categories.clear();
      await db.settings.clear();
    }
    await db.categories.bulkAdd(categoriesToSave);
    await db.products.bulkAdd(productsToSave);
    for (const update of imageUpdates) {
      await db.products.update(update.id, { image: update.image, imageCredit: update.imageCredit });
    }
    if (logo && (mode === 'replace' || !currentLogo)) {
      await db.settings.put({ key: 'catalogLogo', value: logo });
    }
    if (data.whatsapp && (mode === 'replace' || !currentWhatsapp)) {
      await db.settings.put({ key: 'catalogWhatsapp', value: normalizeWhatsAppNumber(data.whatsapp) });
    }
    if (options.markInventoryLoaded || mode === 'replace' || !inventoryState || inventoryState.value === 'pending') {
      await db.settings.put({ key: APP_CONFIG.defaultInventoryKey, value: 'loaded' });
    }
    await db.settings.put({
      key: APP_CONFIG.defaultInventoryRevisionKey,
      value: APP_CONFIG.defaultInventoryRevision
    });
    if (options.initializePhotoUpdate) {
      await db.settings.delete(APP_CONFIG.photoUpdateKey);
    } else if (!options.preservePhotoUpdate) {
      await db.settings.put({
        key: APP_CONFIG.photoUpdateKey,
        value: { version: APP_CONFIG.photoUpdateVersion, suppressed: true }
      });
    }
    return {
      products: productsToSave.length,
      categories: categoriesToSave.length,
      skippedProducts,
      imagesUpdated: imageUpdates.length
    };
  });
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer una imagen del respaldo.'));
    reader.readAsDataURL(blob);
  });
}

export async function dataURLToBlob(value) {
  if (typeof value !== 'string' || !value.startsWith('data:image/')) {
    throw new Error('El respaldo contiene una imagen en un formato no válido.');
  }
  const response = await fetch(value);
  const blob = await response.blob();
  validateImage(blob);
  return blob;
}
