import { waitForCatalogImages, CATEGORY_ACCENTS } from './pdf-service.js';
import { catalogFilename } from '../utils/catalog-filename.js';

const PAGE_WIDTH = 841.89;
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 34;
const GAP = 12;
const STRIPE_HEIGHT = 10;
const MAX_CONTINUOUS_HEIGHT = 7200;
const MIN_PAGE_HEIGHT = 1190.55;
const SIZES = { kicker: 30, tagline: 13, contact: 13.5, step: 13, intro: 32, category: 28, product: 18 };
const PRODUCT_LINE_HEIGHT = 22;
const CATEGORY_LINE_HEIGHT = 33;
const ICON_WIDTH = 32;
const ICON_HEIGHT = 27;
// Static TTF versions of the web fonts used in catalog.css (SIL Open Font License, see assets/fonts).
const FONT_FILES = {
  'DMSans-Regular': 'DMSans-Regular.ttf',
  'DMSans-SemiBold': 'DMSans-SemiBold.ttf',
  'DMSans-Bold': 'DMSans-Bold.ttf',
  'PlayfairDisplay-Bold': 'PlayfairDisplay-Bold.ttf'
};
let libraryPromise;
let fontsPromise;

async function loadPDFLibrary() {
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
  if (!libraryPromise) {
    libraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('../vendor/jspdf.umd.min.js', import.meta.url).href;
      script.onload = () => {
        if (window.jspdf?.jsPDF) resolve(window.jspdf.jsPDF);
        else reject(new Error('La biblioteca PDF no se inició correctamente.'));
      };
      script.onerror = () => {
        script.remove();
        reject(new Error('No se pudo cargar el generador PDF. Intentá nuevamente o usá Imprimir.'));
      };
      document.head.append(script);
    }).catch((error) => {
      libraryPromise = null;
      throw error;
    });
  }
  return libraryPromise;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function loadFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all(Object.entries(FONT_FILES).map(async ([name, file]) => {
      const response = await fetch(new URL(`../../assets/fonts/${file}`, import.meta.url));
      if (!response.ok) throw new Error('No se pudieron cargar las tipografías del catálogo. Intentá nuevamente o usá Imprimir.');
      return [name, file, await blobToBase64(await response.blob())];
    })).catch((error) => {
      fontsPromise = null;
      throw error;
    });
  }
  return fontsPromise;
}

function registerFonts(doc, fonts) {
  for (const [name, file, data] of fonts) {
    doc.addFileToVFS(file, data);
    doc.addFont(file, name, 'normal');
  }
}

function scaledDocument(doc, scale) {
  if (scale === 1) return doc;
  return new Proxy(doc, {
    get(target, property) {
      if (property === 'GState') return target.GState;
      if (property === 'setFontSize' || property === 'setLineWidth') {
        return (value) => target[property](value * scale);
      }
      if (property === 'getTextWidth') {
        return (text) => target.getTextWidth(text) / scale;
      }
      if (property === 'splitTextToSize') {
        return (text, width) => target.splitTextToSize(text, width * scale);
      }
      if (property === 'text') {
        return (text, x, y, options) => target.text(text, x * scale, y * scale, options);
      }
      if (property === 'rect' || property === 'link') {
        return (x, y, width, height, options) =>
          target[property](x * scale, y * scale, width * scale, height * scale, options);
      }
      if (property === 'roundedRect') {
        return (x, y, width, height, rx, ry, style) =>
          target.roundedRect(x * scale, y * scale, width * scale, height * scale, rx * scale, ry * scale, style);
      }
      if (property === 'line') {
        return (x1, y1, x2, y2) => target.line(x1 * scale, y1 * scale, x2 * scale, y2 * scale);
      }
      if (property === 'circle') {
        return (x, y, radius, style) => target.circle(x * scale, y * scale, radius * scale, style);
      }
      if (property === 'addImage') {
        return (data, format, x, y, width, height, alias, compression) =>
          target.addImage(data, format, x * scale, y * scale, width * scale, height * scale, alias, compression);
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

// Mirror the family, weight and color that catalog.css resolves for each element.
function fontFor(element) {
  const style = getComputedStyle(element);
  const family = style.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
  const weight = Number.parseInt(style.fontWeight, 10) || 400;
  if (family === 'playfair display') return { font: 'PlayfairDisplay-Bold', style: 'normal' };
  if (family === 'dm sans') {
    return { font: weight >= 700 ? 'DMSans-Bold' : weight >= 600 ? 'DMSans-SemiBold' : 'DMSans-Regular', style: 'normal' };
  }
  return { font: 'helvetica', style: weight >= 600 ? 'bold' : 'normal' };
}

function colorFor(element) {
  const channels = getComputedStyle(element).color.match(/\d+(\.\d+)?/g)?.slice(0, 3).map(Number);
  return channels?.length === 3 ? channels : [25, 55, 44];
}

function useElementFont(doc, element, size, color = colorFor(element)) {
  const { font, style } = fontFor(element);
  doc.setFont(font, style);
  doc.setFontSize(size);
  if (Array.isArray(color)) doc.setTextColor(...color);
  else doc.setTextColor(color);
}

function measureCatalog(doc, container, compactImageSize = null) {
  const columns = container.classList.contains('catalog-content--spacious') ? 2 : 3;
  const cardWidth = (PAGE_WIDTH - MARGIN * 2 - GAP * (columns - 1)) / columns;
  const imageSize = Math.min(cardWidth - 12, compactImageSize ?? cardWidth - 12);
  const kicker = container.querySelector('.catalog-kicker');
  useElementFont(doc, kicker, SIZES.kicker);
  const headingLines = doc.splitTextToSize(kicker.textContent, PAGE_WIDTH - MARGIN * 2);
  const identityHeight = 100 + headingLines.length * 34 + 28;
  const contactWidth = (PAGE_WIDTH - MARGIN * 2) / 2;
  const contacts = [...container.querySelectorAll('.catalog-contact__item')].map((item) => {
    const label = item.querySelector('span');
    useElementFont(doc, label, SIZES.contact);
    const lines = doc.splitTextToSize(label.textContent, contactWidth - 52);
    return { element: item, lines, width: Math.max(...lines.map((line) => doc.getTextWidth(line))) };
  });
  const contactHeight = Math.max(38, ...contacts.map((contact) => contact.lines.length * 17 + 20));
  const headerTop = STRIPE_HEIGHT + 24;
  const headerHeight = identityHeight + 12 + contactHeight;
  let cursor = headerTop + headerHeight + 20;
  const stepTop = cursor;
  cursor += 140;
  const introTop = cursor;
  const introHeight = 90;
  cursor += introHeight;
  const groups = [];
  for (const [sectionIndex, section] of [...container.querySelectorAll('.catalog-category')].entries()) {
    const titleElement = section.querySelector('.catalog-category__title');
    useElementFont(doc, titleElement, SIZES.category);
    const titleLines = doc.splitTextToSize(titleElement.textContent.trim(), PAGE_WIDTH - MARGIN * 2 - ICON_WIDTH - 16);
    const sectionTop = cursor + 16;
    const headingHeight = titleLines.length * CATEGORY_LINE_HEIGHT + 22;
    cursor = sectionTop + headingHeight + 26;
    const rows = [];
    const productFont = section.querySelector('.catalog-product h3');
    if (productFont) useElementFont(doc, productFont, SIZES.product);
    const products = [...section.querySelectorAll('.catalog-product')].map((element) => {
      const nameLines = doc.splitTextToSize(element.querySelector('h3').textContent, cardWidth - 36);
      const overlayHeight = nameLines.length * PRODUCT_LINE_HEIGHT + 18;
      return { element, nameLines, overlayHeight, imageHeight: Math.max(imageSize, overlayHeight) };
    });
    for (let index = 0; index < products.length; index += columns) {
      const cards = products.slice(index, index + columns);
      const imageHeight = Math.max(...cards.map((card) => card.imageHeight));
      rows.push({ cards, y: cursor, imageHeight, height: imageHeight + 12 });
      cursor += imageHeight + 12 + GAP;
    }
    cursor += 12;
    groups.push({
      titleLines,
      titleElement,
      sectionTop,
      sectionBottom: cursor,
      headingHeight,
      accent: section.dataset.accent || CATEGORY_ACCENTS[sectionIndex % CATEGORY_ACCENTS.length],
      tint: getComputedStyle(section).backgroundColor,
      rows
    });
  }
  return {
    columns,
    headingLines,
    identityHeight,
    contacts,
    contactWidth,
    contactHeight,
    headerTop,
    headerHeight,
    stepTop,
    introTop,
    introHeight,
    groups,
    imageSize,
    cardWidth,
    height: Math.max(MIN_PAGE_HEIGHT, cursor + MARGIN + STRIPE_HEIGHT)
  };
}

function rasterizeImage(image) {
  const scale = Math.min(new URL(image.src).pathname.endsWith('.svg') ? 6 : 1,
    2400 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('El navegador no permite preparar imágenes para el PDF.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

async function prepareImages(container) {
  const imageCache = new Map();
  for (const image of container.querySelectorAll('img')) {
    const source = image.currentSrc || image.src;
    if (imageCache.has(source)) continue;
    const response = await fetch(source);
    if (!response.ok) throw new Error(`No se pudo leer la imagen "${image.alt || source}" para el PDF.`);
    const blob = await response.blob();
    // Preserve original JPEG bytes; use lossless PNG for illustrations and other image types.
    imageCache.set(source, blob.type === 'image/jpeg'
      ? { data: new Uint8Array(await blob.arrayBuffer()), format: 'JPEG' }
      : { data: rasterizeImage(image), format: 'PNG' });
  }
  return imageCache;
}

function drawImage(doc, image, x, y, width, height, imageCache) {
  const source = image.currentSrc || image.src;
  const prepared = imageCache.get(source);
  const ratio = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const fittedWidth = image.naturalWidth * ratio;
  const fittedHeight = image.naturalHeight * ratio;
  doc.addImage(prepared.data, prepared.format,
    x + (width - fittedWidth) / 2, y + (height - fittedHeight) / 2,
    fittedWidth, fittedHeight, source, 'FAST');
}

function cssColorToRGB(value) {
  const channels = value.match(/\d+(\.\d+)?/g)?.slice(0, 3).map(Number);
  return channels?.length === 3 ? channels : [245, 246, 241];
}

function drawStripe(doc, y) {
  const segment = PAGE_WIDTH / CATEGORY_ACCENTS.length;
  for (const [index, color] of CATEGORY_ACCENTS.entries()) {
    doc.setFillColor(color);
    doc.rect(index * segment, y, segment + 0.5, STRIPE_HEIGHT, 'F');
  }
}

function drawHeader(doc, container, layout, imageCache) {
  const top = layout.headerTop;
  drawImage(doc, container.querySelector('.catalog-logo'), (PAGE_WIDTH - 160) / 2, top, 160, 100, imageCache);
  useElementFont(doc, container.querySelector('.catalog-kicker'), SIZES.kicker);
  doc.text(layout.headingLines, PAGE_WIDTH / 2, top + 126, { align: 'center', lineHeightFactor: 34 / SIZES.kicker });
  const tagline = container.querySelector('.catalog-header__tagline');
  useElementFont(doc, tagline, SIZES.tagline);
  doc.text(tagline.textContent, PAGE_WIDTH / 2, top + 100 + layout.headingLines.length * 34 + 18, { align: 'center' });

  const contactTop = top + layout.identityHeight + 12;
  doc.setFillColor('#edf3ed');
  doc.roundedRect(MARGIN, contactTop, PAGE_WIDTH - MARGIN * 2, layout.contactHeight, 5, 5, 'F');
  for (const [index, contact] of layout.contacts.entries()) {
    const columnCenter = MARGIN + layout.contactWidth * (index + 0.5);
    const x = columnCenter - (22 + 9 + contact.width) / 2;
    const textTop = contactTop + (layout.contactHeight - contact.lines.length * 17) / 2 + 13;
    drawImage(doc, contact.element.querySelector('img'), x, contactTop + (layout.contactHeight - 22) / 2, 22, 22, imageCache);
    useElementFont(doc, contact.element.querySelector('span'), SIZES.contact);
    doc.text(contact.lines, x + 31, textTop, { lineHeightFactor: 17 / SIZES.contact });
    doc.link(MARGIN + layout.contactWidth * index, contactTop, layout.contactWidth, layout.contactHeight, { url: contact.element.href });
  }
  doc.setDrawColor('#d6ded2');
  doc.setLineWidth(1);
  doc.line(MARGIN, top + layout.headerHeight + 8, PAGE_WIDTH - MARGIN, top + layout.headerHeight + 8);

  const stepWidth = (PAGE_WIDTH - MARGIN * 2) / 4;
  for (const [index, step] of [...container.querySelectorAll('.order-steps li')].entries()) {
    const center = MARGIN + stepWidth * (index + 0.5);
    drawImage(doc, step.querySelector('img'), center - 33, layout.stepTop, 66, 66, imageCache);
    doc.setFillColor('#edf3ed');
    doc.circle(center, layout.stepTop + 79, 9, 'F');
    useElementFont(doc, step.querySelector('.order-step__number'), 12);
    doc.text(String(index + 1), center, layout.stepTop + 83, { align: 'center' });
    useElementFont(doc, step.querySelector('.order-step__title'), SIZES.step);
    const label = doc.splitTextToSize(step.querySelector('.order-step__title').textContent, stepWidth - 14);
    doc.text(label, center, layout.stepTop + 104, { align: 'center', lineHeightFactor: 1.25 });
    if (index) {
      doc.setDrawColor('#e6e9e2');
      doc.line(center - stepWidth / 2, layout.stepTop + 12, center - stepWidth / 2, layout.stepTop + 120);
    }
  }

  const intro = container.querySelector('.catalog-intro h1');
  const iconSize = 30;
  drawImage(doc, container.querySelector('.cart-icon'), MARGIN + 8, layout.introTop + (layout.introHeight - iconSize) / 2,
    iconSize, iconSize, imageCache);
  useElementFont(doc, intro, SIZES.intro);
  doc.text(intro.textContent.trim(), MARGIN + 8 + iconSize + 9, layout.introTop + layout.introHeight / 2 + SIZES.intro * 0.35);
}

function drawCategory(doc, group, layout, imageCache) {
  doc.setFillColor(...cssColorToRGB(group.tint));
  doc.rect(0, group.sectionTop, PAGE_WIDTH, group.sectionBottom - group.sectionTop, 'F');
  doc.setFillColor(group.accent);
  doc.rect(0, group.sectionTop, PAGE_WIDTH, group.headingHeight, 'F');
  useElementFont(doc, group.titleElement, SIZES.category, '#ffffff');
  const lastLine = group.titleLines.at(-1);
  const lastLineWidth = doc.getTextWidth(lastLine) + 12 + ICON_WIDTH;
  const firstBaseline = group.sectionTop + 11 + SIZES.category * 0.95;
  const earlierLines = group.titleLines.slice(0, -1);
  if (earlierLines.length) {
    doc.text(earlierLines, PAGE_WIDTH / 2, firstBaseline, { align: 'center', lineHeightFactor: CATEGORY_LINE_HEIGHT / SIZES.category });
  }
  const lastBaseline = firstBaseline + earlierLines.length * CATEGORY_LINE_HEIGHT;
  const lastStart = (PAGE_WIDTH - lastLineWidth) / 2;
  doc.text(lastLine, lastStart, lastBaseline);
  drawImage(doc, group.titleElement.querySelector('.catalog-category__icon'), lastStart + lastLineWidth - ICON_WIDTH,
    lastBaseline - ICON_HEIGHT + 4, ICON_WIDTH, ICON_HEIGHT, imageCache);

  for (const row of group.rows) {
    for (const [index, card] of row.cards.entries()) {
      const x = MARGIN + index * (layout.cardWidth + GAP);
      const imageX = x + 6;
      const imageY = row.y + 6;
      const imageWidth = layout.cardWidth - 12;
      doc.setFillColor('#ffffff');
      doc.setDrawColor(group.accent);
      doc.setLineWidth(1.6);
      doc.roundedRect(x, row.y, layout.cardWidth, row.height, 6, 6, 'FD');
      doc.setFillColor('#f5f4ed');
      doc.rect(imageX, imageY, imageWidth, row.imageHeight, 'F');
      drawImage(doc, card.element.querySelector('img'), imageX, imageY, imageWidth, row.imageHeight, imageCache);

      if (card.element.querySelector('.image-illustrative-label')) {
        doc.setFillColor('#24483a');
        doc.roundedRect(imageX + 6, imageY + 6, 116, 22, 3, 3, 'F');
        doc.setFont('DMSans-Bold', 'normal');
        doc.setFontSize(11);
        doc.setTextColor('#ffffff');
        doc.text('Foto ilustrativa', imageX + 12, imageY + 21);
      }

      const overlayTop = imageY + row.imageHeight - card.overlayHeight;
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.92 }));
      doc.setFillColor(group.accent);
      doc.rect(imageX, overlayTop, imageWidth, card.overlayHeight, 'F');
      doc.restoreGraphicsState();
      useElementFont(doc, card.element.querySelector('h3'), SIZES.product, '#ffffff');
      doc.text(card.nameLines, x + layout.cardWidth / 2, overlayTop + 9 + SIZES.product * 0.82,
        { align: 'center', lineHeightFactor: PRODUCT_LINE_HEIGHT / SIZES.product });
    }
  }
}

function paginateCatalog(layout, maxPageHeight, fixedHeight) {
  const pages = [];
  const newPage = (first) => {
    const page = {
      first,
      groups: [],
      cursor: first ? layout.introTop + layout.introHeight : MARGIN + STRIPE_HEIGHT
    };
    pages.push(page);
    return page;
  };
  let page = newPage(true);
  const bottomLimit = maxPageHeight - MARGIN - STRIPE_HEIGHT;

  for (const group of layout.groups) {
    let index = 0;
    while (index < group.rows.length) {
      const sectionTop = page.cursor + 16;
      let rowTop = sectionTop + group.headingHeight + 26;
      if (rowTop + group.rows[index].height + GAP + 12 > bottomLimit) {
        if (!page.first && !page.groups.length) {
          throw new Error('Un producto es demasiado alto para incluirlo en una página PDF.');
        }
        page = newPage(false);
        continue;
      }

      const rows = [];
      while (index < group.rows.length &&
          rowTop + group.rows[index].height + GAP + 12 <= bottomLimit) {
        const row = group.rows[index++];
        rows.push({ ...row, y: rowTop });
        rowTop += row.height + GAP;
      }
      page.cursor = rowTop + 12;
      page.groups.push({ ...group, sectionTop, sectionBottom: page.cursor, rows });
      if (index < group.rows.length) page = newPage(false);
    }
  }
  if (!layout.groups.length) page.cursor += 45;
  for (const item of pages) {
    item.height = fixedHeight ? maxPageHeight : Math.max(MIN_PAGE_HEIGHT, item.cursor + MARGIN + STRIPE_HEIGHT);
  }
  return pages;
}

function drawPageNumber(doc, page, total, height) {
  doc.setFont('DMSans-Regular', 'normal');
  doc.setFontSize(12);
  doc.setTextColor('#536157');
  doc.text(`${page} / ${total}`, PAGE_WIDTH - MARGIN, height - STRIPE_HEIGHT - 8, { align: 'right' });
}

export async function buildCatalogPDF(container, format = 'a4') {
  if (!['a4', 'continuous'].includes(format)) throw new Error('El formato de PDF no es válido.');
  const scale = format === 'a4' ? A4_WIDTH / PAGE_WIDTH : 1;
  const fixedHeight = format === 'a4';
  const maxPageHeight = fixedHeight ? A4_HEIGHT / scale : MAX_CONTINUOUS_HEIGHT;
  const PDF = await loadPDFLibrary();
  const [fonts] = await Promise.all([loadFonts(), waitForCatalogImages(container)]);
  const measuringDocument = new PDF({ unit: 'pt', format: 'a4' });
  registerFonts(measuringDocument, fonts);
  const measuringCanvas = scaledDocument(measuringDocument, scale);
  const compactImageSize = fixedHeight && !container.classList.contains('catalog-content--spacious') ? 215 : null;
  const layout = measureCatalog(measuringCanvas, container, compactImageSize);
  const pages = paginateCatalog(layout, maxPageHeight, fixedHeight);

  const doc = new PDF({
    unit: 'pt',
    orientation: 'portrait',
    format: [PAGE_WIDTH * scale, pages[0].height * scale],
    compress: true,
    putOnlyUsedFonts: true
  });
  registerFonts(doc, fonts);
  doc.setProperties({ title: catalogFilename(), creator: 'El Hornero Market' });
  const canvas = scaledDocument(doc, scale);
  const imageCache = await prepareImages(container);
  const totalPages = pages.length;
  for (const [index, page] of pages.entries()) {
    if (index) doc.addPage([PAGE_WIDTH * scale, page.height * scale], 'portrait');
    drawStripe(canvas, 0);
    if (page.first) {
      drawHeader(canvas, container, layout, imageCache);
      if (!layout.groups.length) {
        const empty = container.querySelector('.catalog-empty');
        useElementFont(canvas, empty, 12);
        canvas.text(empty.textContent, PAGE_WIDTH / 2, layout.introTop + layout.introHeight + 30, { align: 'center' });
      }
    }
    for (const group of page.groups) drawCategory(canvas, group, layout, imageCache);
    drawStripe(canvas, page.height - STRIPE_HEIGHT);
    if (fixedHeight) drawPageNumber(canvas, index + 1, totalPages, page.height);
  }
  return doc;
}

export async function downloadCatalogPDF(container, format = 'a4') {
  const doc = await buildCatalogPDF(container, format);
  const suffix = format === 'continuous' ? ' - Continuo' : '';
  await doc.save(`${catalogFilename()}${suffix}.pdf`, { returnPromise: true });
}
