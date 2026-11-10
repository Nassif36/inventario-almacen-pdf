import { APP_CONFIG } from '../config.js';
import { getDatabase } from '../database/db.js';
import { dataURLToBlob, restoreBackup, validateBackup } from './backup-service.js';
import { productKey } from '../utils/validators.js';

const CREDIT_MIGRATION_KEY = 'validatedImageCreditsReviewed';
let defaultBackupPromise;

async function readDefaultBackup() {
  if (!defaultBackupPromise) {
    defaultBackupPromise = (async () => {
      const response = await fetch(new URL('../../inventario/respaldo-el-hornero.json', import.meta.url), { cache: 'no-cache' });
      if (!response.ok) throw new Error('No se pudo cargar el inventario validado incluido en el proyecto.');
      const backup = await response.json();
      validateBackup(backup);
      return backup;
    })().catch((error) => {
      defaultBackupPromise = null;
      throw error;
    });
  }
  return defaultBackupPromise;
}

export async function initializeDefaultInventory() {
  const db = getDatabase();
  const state = await db.transaction('rw', db.settings, async () => {
    let record = await db.settings.get(APP_CONFIG.defaultInventoryKey);
    if (!record) {
      record = { key: APP_CONFIG.defaultInventoryKey, value: 'existing' };
      await db.settings.add(record);
    }
    return record.value;
  });

  if (state === 'pending') {
    await loadDefaultInventory(false);
    return { state: 'loaded', photosUpdated: 0 };
  }
  if (state === 'existing' || state === 'loaded') await attachKnownImageCredits();
  const photoUpdate = state === 'loaded' ? await applyBundledPhotoUpdate() : { updated: 0 };
  return { state, photosUpdated: photoUpdate.updated };
}

export async function loadDefaultInventory(manual = true) {
  const backup = await readDefaultBackup();
  const result = await restoreBackup(backup, 'merge', {
    allowedInventoryStates: [manual ? 'existing' : 'pending'],
    markInventoryLoaded: true,
    fillMissingImages: manual,
    initializePhotoUpdate: true
  });
  await attachKnownImageCredits(true);
  await applyBundledPhotoUpdate();
  return result;
}

export async function applyBundledPhotoUpdate() {
  const db = getDatabase();
  const response = await fetch(new URL('../../inventario/actualizacion-fotografias.json', import.meta.url), { cache: 'no-cache' });
  if (!response.ok) throw new Error('No se pudo cargar la actualización de fotografías incluida.');
  const manifest = await response.json();
  if (!manifest || manifest.version !== APP_CONFIG.photoUpdateVersion || !Array.isArray(manifest.updates)) {
    throw new Error('La actualización de fotografías no tiene un formato válido.');
  }
  const ids = new Set();
  for (const entry of manifest.updates) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.updatedAt !== 'string' || ids.has(entry.id)) {
      throw new Error('La actualización contiene un producto inválido o repetido.');
    }
    ids.add(entry.id);
  }

  const record = await db.settings.get(APP_CONFIG.photoUpdateKey);
  const previous = record?.value?.version === manifest.version ? record.value : null;
  if (previous?.suppressed) return { updated: 0 };
  if (previous && !Array.isArray(previous.processedIds)) {
    throw new Error('El estado de la actualización de fotografías no es válido.');
  }
  const processed = new Set(previous?.processedIds || []);
  const pending = manifest.updates.filter((entry) => !processed.has(entry.id));
  if (!pending.length) return { updated: 0 };
  const backup = await readDefaultBackup();
  const byId = new Map(backup.products.map((product) => [product.id, product]));
  const prepared = await Promise.all(pending.map(async (entry) => {
    const source = byId.get(entry.id);
    if (!source?.image || !source.imageCredit) {
      throw new Error('Una fotografía de la actualización no está en el respaldo incluido.');
    }
    return { ...entry, source, image: await dataURLToBlob(source.image) };
  }));

  return db.transaction('rw', db.products, db.settings, async () => {
    const latestRecord = await db.settings.get(APP_CONFIG.photoUpdateKey);
    const latest = latestRecord?.value?.version === manifest.version ? latestRecord.value : null;
    if (latest?.suppressed) return { updated: 0 };
    if (latest && !Array.isArray(latest.processedIds)) {
      throw new Error('El estado de la actualización de fotografías no es válido.');
    }
    const done = new Set(latest?.processedIds || []);
    let updated = 0;
    for (const entry of prepared) {
      if (done.has(entry.id)) continue;
      const current = await db.products.get(entry.id);
      if (current && !current.image && !current.imageCredit && current.updatedAt === entry.updatedAt &&
          productKey(current) === productKey(entry.source)) {
        await db.products.update(entry.id, {
          image: entry.image,
          imageCredit: entry.source.imageCredit,
          updatedAt: new Date().toISOString()
        });
        updated += 1;
      }
      done.add(entry.id);
    }
    await db.settings.put({
      key: APP_CONFIG.photoUpdateKey,
      value: { version: manifest.version, processedIds: [...done] }
    });
    return { updated };
  });
}

export async function attachKnownImageCredits(force = false) {
  const db = getDatabase();
  if (!force && await db.settings.get(CREDIT_MIGRATION_KEY)) return;
  const current = (await db.products.toArray()).filter((product) => product.image && !product.imageCredit);
  const updates = [];
  if (current.length) {
    const backup = await readDefaultBackup();
    const byId = new Map(backup.products.map((product) => [product.id, product]));
    const byKey = new Map(backup.products.map((product) => [productKey(product), product]));
    for (const product of current) {
      const source = byId.get(product.id) || byKey.get(productKey(product));
      if (!source?.image || !source.imageCredit) continue;
      const sourceImage = await dataURLToBlob(source.image);
      if (sourceImage.size !== product.image.size || sourceImage.type !== product.image.type) continue;
      const [left, right] = await Promise.all([sourceImage.arrayBuffer(), product.image.arrayBuffer()]);
      const leftBytes = new Uint8Array(left);
      const rightBytes = new Uint8Array(right);
      if (leftBytes.every((value, index) => value === rightBytes[index])) {
        updates.push({ id: product.id, updatedAt: product.updatedAt, size: product.image.size, credit: source.imageCredit });
      }
    }
  }
  await db.transaction('rw', db.products, db.settings, async () => {
    for (const update of updates) {
      const product = await db.products.get(update.id);
      if (product?.image && !product.imageCredit && product.updatedAt === update.updatedAt &&
          product.image.size === update.size) {
        await db.products.update(product.id, { imageCredit: update.credit });
      }
    }
    await db.settings.put({ key: CREDIT_MIGRATION_KEY, value: true });
  });
}
