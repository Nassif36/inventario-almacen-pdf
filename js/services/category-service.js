import { getDatabase } from '../database/db.js';
import { createId, normalizeKey, normalizeText } from '../utils/validators.js';

export async function listCategories() {
  return getDatabase().categories.orderBy('name').toArray();
}

export async function saveCategory(name, id = null) {
  const db = getDatabase();
  const cleanedName = normalizeText(name);
  if (!cleanedName) throw new Error('El nombre de la categoría es obligatorio.');

  const existing = await db.categories.toArray();
  const duplicate = existing.find((category) =>
    normalizeKey(category.name) === normalizeKey(cleanedName) && category.id !== id
  );
  if (duplicate) throw new Error('Ya existe una categoría con ese nombre.');

  if (id) {
    const category = await db.categories.get(id);
    if (!category) throw new Error('No encontramos la categoría que querés editar.');
    await db.transaction('rw', db.categories, db.products, async () => {
      await db.categories.put({ ...category, name: cleanedName });
      await db.products.where('category').equals(category.name).modify({ category: cleanedName });
    });
    return { ...category, name: cleanedName };
  }

  const category = { id: createId(), name: cleanedName, createdAt: new Date().toISOString() };
  await db.categories.add(category);
  return category;
}

export async function deleteCategory(id, strategy = {}) {
  const db = getDatabase();
  const category = await db.categories.get(id);
  if (!category) throw new Error('No encontramos la categoría que querés eliminar.');

  const products = await db.products.where('category').equals(category.name).toArray();
  if (products.length && !strategy.reassignTo && !strategy.deleteProducts) {
    throw new Error('Elegí otra categoría para reasignar los productos o confirmá que querés eliminarlos.');
  }

  if (strategy.reassignTo) {
    const destination = await db.categories.get(strategy.reassignTo);
    if (!destination || destination.id === id) throw new Error('Elegí una categoría de destino válida.');
  }

  await db.transaction('rw', db.categories, db.products, async () => {
    if (strategy.reassignTo) {
      const destination = await db.categories.get(strategy.reassignTo);
      await db.products.where('category').equals(category.name).modify({ category: destination.name });
    } else if (strategy.deleteProducts) {
      await db.products.where('category').equals(category.name).delete();
    }
    await db.categories.delete(id);
  });

  return products.length;
}
