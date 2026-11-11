import { APP_CONFIG } from '../config.js';
import { normalizeProductTitle } from '../utils/validators.js';

let database;

export function getDatabase() {
  if (database) {
    return database;
  }

  if (typeof window.Dexie !== 'function') {
    throw new Error('No se pudo cargar Dexie.js para iniciar el almacenamiento local.');
  }

  const Dexie = window.Dexie;
  database = new Dexie(APP_CONFIG.databaseName);
  database.version(1).stores({
    products: '&id,title,brand,category,createdAt,updatedAt',
    categories: '&id,name,createdAt'
  });
  database.version(2).stores({
    products: '&id,title,brand,category,createdAt,updatedAt',
    categories: '&id,name,createdAt',
    settings: '&key'
  });
  database.version(3).stores({
    products: '&id,title,brand,category,createdAt,updatedAt',
    categories: '&id,name,createdAt',
    settings: '&key'
  }).upgrade((transaction) => transaction.table('products').toCollection().modify((product) => {
    product.title = normalizeProductTitle(product.title);
  }));
  database.on('populate', () => {
    database.settings.add({ key: APP_CONFIG.defaultInventoryKey, value: 'pending' });
  });

  return database;
}

export async function initializeDatabase() {
  const db = getDatabase();
  await db.open();
  return db;
}
