import { inspectCSV, sampleCSV } from '../services/csv-import-service.js';
import { escapeHTML } from '../utils/validators.js';
import { pluralize } from '../utils/formatters.js';

export function openCSVImporter({ dialog, onImport }) {
  let review = null;
  let selectedFile = null;
  let sampleURL = null;

  dialog.innerHTML = `
    <div class="dialog-form">
      <div class="dialog-heading">
        <div><p class="eyebrow">CARGA EN LOTE</p><h2 id="csv-dialog-title">Importar desde CSV</h2></div>
        <button class="icon-button" type="button" data-dialog-close aria-label="Cerrar">×</button>
      </div>
      <p class="dialog-description">Elegí un archivo CSV con las columnas obligatorias <code>title</code> y <code>category</code>. <code>brand</code> e <code>image_url</code> son opcionales. Para conservar créditos, incluí también <code>image_author</code>, <code>image_product_url</code>, <code>image_original_url</code>, <code>image_license</code> e <code>image_license_url</code>; <code>image_changes</code> indica modificaciones y <code>image_illustrative</code> marca fotos ilustrativas. Revisá cada fila antes de importar.</p>
      <a class="text-link sample-link" href="#" download="plantilla-productos-hornero.csv">Descargar plantilla de ejemplo →</a>
      <label class="upload-field csv-upload">Archivo CSV <input id="csv-file" type="file" accept=".csv,text/csv" required><span>Seleccioná el archivo CSV de tu dispositivo.</span></label>
      <div id="csv-preview" class="csv-preview" aria-live="polite"></div>
      <p class="form-message" id="csv-message" role="alert"></p>
      <div class="dialog-actions" id="csv-actions"><button class="button button--quiet" type="button" data-dialog-close>Cancelar</button></div>
    </div>`;

  const fileInput = dialog.querySelector('#csv-file');
  const preview = dialog.querySelector('#csv-preview');
  const message = dialog.querySelector('#csv-message');
  const actions = dialog.querySelector('#csv-actions');
  const sampleLink = dialog.querySelector('.sample-link');
  sampleURL = URL.createObjectURL(new Blob([sampleCSV()], { type: 'text/csv;charset=utf-8' }));
  sampleLink.href = sampleURL;

  fileInput.addEventListener('change', async () => {
    selectedFile = fileInput.files[0] || null;
    review = null;
    preview.replaceChildren();
    actions.querySelector('[data-import-confirm]')?.remove();
    if (!selectedFile) return;
    message.textContent = '';
    preview.textContent = 'Revisando el archivo…';
    try {
      review = await inspectCSV(selectedFile);
      renderPreview(preview, review);
      if (review.validCount) {
        const importButton = document.createElement('button');
        importButton.className = 'button button--primary';
        importButton.type = 'button';
        importButton.dataset.importConfirm = '';
        importButton.textContent = `Importar ${pluralize(review.validCount, 'producto', 'productos')}`;
        actions.append(importButton);
        importButton.addEventListener('click', async () => {
          importButton.disabled = true;
          importButton.textContent = 'Importando…';
          try {
            const result = await onImport(review.rows.filter((row) => row.valid).map((row) => row.product));
            const warnings = result.imageErrors.length
              ? ` ${result.imageErrors.length} imagen(es) no se pudieron guardar.`
              : '';
            preview.innerHTML = `<div class="import-result"><strong>Importación terminada</strong><span>Se agregaron ${pluralize(result.imported, 'producto', 'productos')}.${warnings}</span>${result.imageErrors.length ? `<ul>${result.imageErrors.map((error) => `<li>${escapeHTML(error)}</li>`).join('')}</ul>` : ''}</div>`;
            message.textContent = review.invalidCount
              ? `${review.invalidCount} fila(s) inválida(s) no se importaron. Revisá sus errores en la vista previa.`
              : '';
            importButton.remove();
            importButton.insertAdjacentText('beforebegin', ' ');
            const closeButton = document.createElement('button');
            closeButton.className = 'button button--quiet';
            closeButton.type = 'button';
            closeButton.textContent = 'Cerrar';
            closeButton.addEventListener('click', () => dialog.close());
            actions.append(closeButton);
          } catch (error) {
            message.textContent = error.message;
            importButton.disabled = false;
            importButton.textContent = `Importar ${pluralize(review.validCount, 'producto', 'productos')}`;
          }
        });
      } else {
        actions.querySelector('[data-import-confirm]')?.remove();
      }
    } catch (error) {
      preview.replaceChildren();
      message.textContent = error.message;
    }
  });

  dialog.querySelectorAll('[data-dialog-close]').forEach((button) =>
    button.addEventListener('click', () => dialog.close())
  );
  dialog.addEventListener('close', () => {
    if (sampleURL) URL.revokeObjectURL(sampleURL);
  }, { once: true });
  dialog.showModal();
}

function renderPreview(container, review) {
  const summary = document.createElement('div');
  summary.className = 'csv-summary';
  summary.innerHTML = `<strong>${pluralize(review.rows.length, 'fila', 'filas')} detectadas</strong><span>${pluralize(review.validCount, 'fila lista', 'filas listas')} · ${pluralize(review.invalidCount, 'fila con problemas', 'filas con problemas')}</span>`;
  container.append(summary);

  if (review.parseErrors.length) {
    const errors = document.createElement('ul');
    errors.className = 'csv-errors';
    for (const error of review.parseErrors) {
      const item = document.createElement('li');
      item.textContent = error;
      errors.append(item);
    }
    container.append(errors);
  }

  const table = document.createElement('div');
  table.className = 'csv-table-wrap';
  table.innerHTML = '<table class="csv-table"><thead><tr><th>Fila</th><th>Producto</th><th>Marca</th><th>Categoría</th><th>Revisión</th></tr></thead><tbody></tbody></table>';
  const body = table.querySelector('tbody');
  for (const row of review.rows) {
    const tr = document.createElement('tr');
    const details = [row.errors.join(' '), !row.categoryExists && !row.errors.length ? 'La categoría se creará al importar.' : ''].filter(Boolean).join(' ');
    tr.innerHTML = `<td>${row.rowNumber}</td><td>${escapeHTML(row.product.title || '—')}</td><td>${escapeHTML(row.product.brand || '—')}</td><td>${escapeHTML(row.product.category || '—')}</td><td class="${row.valid ? 'csv-valid' : 'csv-invalid'}">${escapeHTML(row.valid ? 'Lista' : details)}</td>`;
    body.append(tr);
  }
  container.append(table);
}
