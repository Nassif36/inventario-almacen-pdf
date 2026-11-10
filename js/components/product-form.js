import { escapeHTML, validateImage } from '../utils/validators.js';

export function openProductForm({ dialog, product, categories, onSave, onCreateCategory }) {
  const imageURL = product?.image ? URL.createObjectURL(product.image) : null;
  const options = categories.map((category) =>
    `<option value="${escapeHTML(category.name)}" ${category.name === product?.category ? 'selected' : ''}>${escapeHTML(category.name)}</option>`
  ).join('');
  dialog.innerHTML = `
    <form class="dialog-form" id="product-form">
      <div class="dialog-heading">
        <div><p class="eyebrow">${product ? 'ACTUALIZAR CATÁLOGO' : 'NUEVO EN EL CATÁLOGO'}</p><h2 id="product-dialog-title">${product ? 'Editar producto' : 'Agregar producto'}</h2></div>
        <button class="icon-button" type="button" data-dialog-close aria-label="Cerrar">×</button>
      </div>
      <label>Nombre del producto <input name="title" maxlength="120" required value="${escapeHTML(product?.title || '')}" placeholder="Ej. Yerba mate 1 kg"></label>
      <label>Marca <input name="brand" maxlength="80" value="${escapeHTML(product?.brand || '')}" placeholder="Opcional"></label>
      <div class="field-with-action"><label>Categoría <select name="category" required><option value="">Elegí una categoría</option>${options}</select></label><button class="button button--quiet button--small" type="button" data-action="create-category">＋ Nueva</button></div>
      <div class="inline-category" hidden><input name="newCategory" maxlength="60" placeholder="Nombre de la nueva categoría" aria-label="Nombre de la nueva categoría"><button class="button button--quiet button--small" type="button" data-save-category>Crear categoría</button></div>
      <label class="upload-field">Imagen del producto <input name="image" type="file" accept="image/jpeg,image/png,image/webp"><span>JPG, PNG o WebP · Máximo 5 MB</span></label>
      <div class="image-preview ${imageURL ? '' : 'image-preview--empty'}" id="product-image-preview">${imageURL ? `<img src="${imageURL}" alt="Vista previa de ${escapeHTML(product.title)}">` : '<img src="assets/placeholders/product.svg" alt="Vista previa del marcador de posición">'}</div>
      ${product?.image ? '<label class="check-field"><input name="removeImage" type="checkbox"> Quitar imagen actual</label>' : ''}
      <p class="form-message" role="alert"></p>
      <div class="dialog-actions"><button class="button button--quiet" type="button" data-dialog-close>Cancelar</button><button class="button button--primary" type="submit">${product ? 'Guardar cambios' : 'Agregar producto'}</button></div>
    </form>`;

  const form = dialog.querySelector('#product-form');
  const imageInput = form.elements.image;
  const preview = dialog.querySelector('#product-image-preview');
  imageInput.addEventListener('change', () => {
    const file = imageInput.files[0];
    if (!file) return;
    try {
      validateImage(file);
      if (preview.dataset.url) URL.revokeObjectURL(preview.dataset.url);
      preview.dataset.url = URL.createObjectURL(file);
      preview.innerHTML = '';
      const image = document.createElement('img');
      image.src = preview.dataset.url;
      image.alt = 'Vista previa de la imagen seleccionada';
      preview.append(image);
      preview.classList.remove('image-preview--empty');
      form.querySelector('.form-message').textContent = '';
    } catch (error) {
      imageInput.value = '';
      form.querySelector('.form-message').textContent = error.message;
    }
  });

  const inlineCategory = form.querySelector('.inline-category');
  form.querySelector('[data-action="create-category"]').addEventListener('click', () => {
    inlineCategory.hidden = !inlineCategory.hidden;
    if (!inlineCategory.hidden) form.elements.newCategory.focus();
  });
  form.querySelector('[data-save-category]').addEventListener('click', async () => {
    const name = form.elements.newCategory.value;
    if (!name.trim()) {
      form.querySelector('.form-message').textContent = 'Escribí el nombre de la categoría.';
      return;
    }
    try {
      const category = await onCreateCategory(name);
      const select = form.elements.category;
      if (![...select.options].some((option) => option.value === category.name)) {
        select.add(new Option(category.name, category.name));
      }
      select.value = category.name;
      form.elements.newCategory.value = '';
      inlineCategory.hidden = true;
      form.querySelector('.form-message').textContent = '';
    } catch (error) {
      form.querySelector('.form-message').textContent = error.message;
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = form.querySelector('.form-message');
    const file = imageInput.files[0];
    try {
      if (file) validateImage(file);
      const image = form.elements.removeImage?.checked ? null : file || product?.image || null;
      await onSave({
        id: product?.id,
        title: form.elements.title.value,
        brand: form.elements.brand.value,
        category: form.elements.category.value,
        image,
        imageCredit: image && !file ? product?.imageCredit : null,
        createdAt: product?.createdAt
      });
      if (imageURL) URL.revokeObjectURL(imageURL);
      if (preview.dataset.url) URL.revokeObjectURL(preview.dataset.url);
      dialog.close();
    } catch (error) {
      message.textContent = error.message;
    }
  });

  dialog.querySelectorAll('[data-dialog-close]').forEach((button) =>
    button.addEventListener('click', () => dialog.close())
  );
  dialog.addEventListener('close', () => {
    if (imageURL) URL.revokeObjectURL(imageURL);
    if (preview.dataset.url) URL.revokeObjectURL(preview.dataset.url);
  }, { once: true });
  dialog.showModal();
}
