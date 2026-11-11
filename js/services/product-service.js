import { getDatabase } from '../database/db.js';
import { createId, normalizeImageCredit, normalizeProductTitle, normalizeText, validateImage } from '../utils/validators.js';

export async function listProducts() {
  return getDatabase().products.orderBy('title').toArray();
}

export async function saveProduct(input) {
  const db = getDatabase();
  const title = normalizeProductTitle(input.title);
  const category = normalizeText(input.category);
  const brand = normalizeText(input.brand);
  if (!title) throw new Error('El nombre del producto es obligatorio.');
  if (!category) throw new Error('Elegí una categoría.');

  if (input.image instanceof Blob) validateImage(input.image);

  const now = new Date().toISOString();
  const product = {
    id: input.id || createId(),
    title,
    brand,
    category,
    image: input.image || null,
    imageCredit: input.image ? normalizeImageCredit(input.imageCredit) : null,
    createdAt: input.createdAt || now,
    updatedAt: now
  };
  await db.products.put(product);
  return product;
}

export async function deleteProduct(id) {
  await getDatabase().products.delete(id);
}

export async function importProducts(products) {
  const db = getDatabase();
  await db.transaction('rw', db.products, db.categories, async () => {
    for (const product of products) {
      const categoryName = normalizeText(product.category);
      let category = await db.categories.where('name').equalsIgnoreCase(categoryName).first();
      if (!category) {
        category = { id: createId(), name: categoryName, createdAt: new Date().toISOString() };
        await db.categories.add(category);
      }
      const now = new Date().toISOString();
      await db.products.add({
        id: createId(),
        title: normalizeProductTitle(product.title),
        brand: normalizeText(product.brand),
        category: category.name,
        image: product.image || null,
        imageCredit: product.image ? normalizeImageCredit(product.imageCredit) : null,
        createdAt: now,
        updatedAt: now
      });
    }
  });
}
