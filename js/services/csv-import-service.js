import { getDatabase } from '../database/db.js';
import { normalizeImageCredit, normalizeKey, normalizeProductTitle, normalizeText, productKey, validateImage } from '../utils/validators.js';

const REQUIRED_COLUMNS = ['title', 'category'];

export function parseCSV(file) {
  if (!window.Papa) throw new Error('No se pudo cargar el lector CSV. Revisá tu conexión e intentá nuevamente.');
  return new Promise((resolve, reject) => {
    window.Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => header.trim().toLocaleLowerCase('es'),
      complete: (result) => resolve(result),
      error: (error) => reject(error)
    });
  });
}

export async function inspectCSV(file) {
  const parsed = await parseCSV(file);
  const columns = parsed.meta.fields || [];
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
  if (missingColumns.length) {
    throw new Error(`Faltan columnas en el CSV: ${missingColumns.join(', ')}.`);
  }

  const db = getDatabase();
  const [products, categories] = await Promise.all([
    db.products.toArray(),
    db.categories.toArray()
  ]);
  const knownProducts = new Set(products.map(productKey));
  const seen = new Set();
  const rows = parsed.data.map((record, index) => {
    const title = normalizeProductTitle(record.title);
    const brand = normalizeText(record.brand);
    const category = normalizeText(record.category);
    const imageURL = normalizeText(record.image_url);
    const errors = [];
    if (!title) errors.push('Falta el nombre del producto.');
    if (!category) errors.push('Falta la categoría.');
    if (imageURL && !isWebURL(imageURL)) errors.push('La imagen debe ser una URL http(s) o una ruta local del proyecto.');

    const rawCredit = {
      author: record.image_author,
      productUrl: record.image_product_url,
      imageUrl: record.image_original_url,
      license: record.image_license,
      licenseUrl: record.image_license_url,
      changes: record.image_changes
    };
    const illustrative = normalizeText(record.image_illustrative).toLocaleLowerCase('es');
    if (illustrative && !['true', 'false'].includes(illustrative)) {
      errors.push('La columna image_illustrative debe contener true o false.');
    }
    let imageCredit = null;
    if (Object.values(rawCredit).some((value) => normalizeText(value))) {
      try {
        if (!imageURL) throw new Error('La atribución necesita una imagen.');
        imageCredit = normalizeImageCredit({ ...rawCredit, illustrative: illustrative === 'true' });
      } catch (error) {
        errors.push(error.message);
      }
    } else if (illustrative === 'true') {
      errors.push('Una imagen ilustrativa debe incluir sus créditos.');
    }

    const product = { title, brand, category, imageURL, imageCredit };
    const key = productKey(product);
    const duplicate = Boolean(title && category && (knownProducts.has(key) || seen.has(key)));
    if (duplicate) errors.push('Producto duplicado: no se sobrescribirán datos existentes.');
    if (title && category) seen.add(key);

    return {
      rowNumber: index + 2,
      product,
      errors,
      duplicate,
      valid: errors.length === 0,
      categoryExists: categories.some((item) => normalizeKey(item.name) === normalizeKey(category))
    };
  });

  return {
    rows,
    parseErrors: parsed.errors.map((error) => `Fila ${error.row + 1}: ${error.message}`),
    validCount: rows.filter((row) => row.valid).length,
    invalidCount: rows.filter((row) => !row.valid).length
  };
}

export async function retrieveProductImage(url) {
  if (!url) return { image: null, error: null };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const imageURL = new URL(url, document.baseURI);
    if (!['http:', 'https:'].includes(imageURL.protocol)) {
      throw new Error('protocolo no compatible');
    }
    const response = await fetch(imageURL.href, { mode: 'cors', signal: controller.signal });
    if (!response.ok) throw new Error(`respuesta ${response.status}`);
    const image = await response.blob();
    validateImage(image);
    return { image, error: null };
  } catch (error) {
    return { image: null, error: `No se pudo guardar la imagen de "${url}"; se usará el marcador de posición.` };
  } finally {
    clearTimeout(timeout);
  }
}

export function sampleCSV() {
  const credit = 'Colaboradores de Open Food Facts';
  const license = 'CC BY-SA 3.0,https://creativecommons.org/licenses/by-sa/3.0/';
  return [
    'title,brand,category,image_url,image_author,image_product_url,image_original_url,image_license,image_license_url,image_changes,image_illustrative',
    `Coca-Cola Original,Coca-Cola,Bebidas,assets/products/coca-cola-original.jpg,${credit},https://world.openfoodfacts.org/product/5449000000996,https://images.openfoodfacts.org/images/products/544/900/000/0996/front_en.1129.400.jpg,${license},,`,
    `Agua Cristaline,Cristaline,Bebidas,assets/products/agua-cristaline.jpg,${credit},https://world.openfoodfacts.org/product/3274080005003,https://images.openfoodfacts.org/images/products/327/408/000/5003/front_en.797.400.jpg,${license},,`,
    `Spaghetti Barilla No. 5,Barilla,Pastas y almacén,assets/products/barilla-spaghetti-5.jpg,${credit},https://world.openfoodfacts.org/product/8076800195057,https://images.openfoodfacts.org/images/products/807/680/019/5057/front_en.3881.400.jpg,${license},,`,
    `Nutella,Nutella,Untables y dulces,assets/products/nutella.jpg,${credit},https://world.openfoodfacts.org/product/3017620422003,https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.879.400.jpg,${license},,`
  ].join('\r\n');
}

function isWebURL(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value, document.baseURI).protocol);
  } catch {
    return false;
  }
}
