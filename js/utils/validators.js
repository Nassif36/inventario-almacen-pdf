import { APP_CONFIG } from '../config.js';

export function validateImage(file) {
  if (!file || !APP_CONFIG.supportedImageTypes.includes(file.type)) {
    throw new Error('Elegí una imagen JPG, PNG o WebP.');
  }
  if (file.size > APP_CONFIG.maxImageBytes) {
    throw new Error('La imagen debe pesar 5 MB o menos.');
  }
}

export function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export function normalizeKey(value) {
  return normalizeText(value).toLocaleLowerCase('es');
}

export function productKey(product) {
  return [product.title, product.brand, product.category].map(normalizeKey).join('|');
}

export function normalizeImageCredit(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('La atribución de la imagen no es válida.');
  }
  const credit = {
    author: normalizeText(value.author),
    productUrl: normalizeText(value.productUrl),
    imageUrl: normalizeText(value.imageUrl),
    license: normalizeText(value.license),
    licenseUrl: normalizeText(value.licenseUrl)
  };
  if (!credit.author || !credit.productUrl || !credit.imageUrl || !credit.license || !credit.licenseUrl) {
    throw new Error('La atribución debe incluir autor, producto, imagen y licencia.');
  }
  for (const url of [credit.productUrl, credit.imageUrl, credit.licenseUrl]) {
    try {
      if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error();
    } catch {
      throw new Error('Las direcciones de atribución deben comenzar con http:// o https://.');
    }
  }
  const changes = normalizeText(value.changes);
  if (changes) credit.changes = changes;
  if (value.illustrative != null && typeof value.illustrative !== 'boolean') {
    throw new Error('La indicación de imagen ilustrativa no es válida.');
  }
  if (value.illustrative) credit.illustrative = true;
  return credit;
}

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

export function createId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${crypto.getRandomValues(new Uint32Array(2)).join('-')}`;
}
