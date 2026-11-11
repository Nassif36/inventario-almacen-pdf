"""Reduce el peso de las fotos del inventario y sincroniza los datos que las usan.

Uso (desde la carpeta principal del proyecto):
    python scripts/optimizar_imagenes.py            # optimiza y guarda respaldo
    python scripts/optimizar_imagenes.py --simular  # solo informa el ahorro estimado

- Limita el lado mayor de cada foto (900 px por defecto) y quita metadatos.
- Fotos opacas: JPEG progresivo. Fotos con transparencia: WebP con canal alfa.
- El logo se mantiene en PNG.
- Actualiza rutas en CSV/manifiestos, las fotos incrustadas en respaldo-el-hornero.json,
  y publica una actualización de fotografías para navegadores que ya tienen el inventario.
- Copia los archivos originales a una carpeta de respaldo fuera del proyecto.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import io
import json
import re
import shutil
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
INVENTARIO = ROOT / 'inventario'
IMAGENES = INVENTARIO / 'imagenes'
RESPALDO = INVENTARIO / 'respaldo-el-hornero.json'
ACTUALIZACION = INVENTARIO / 'actualizacion-fotografias.json'
CONFIG = ROOT / 'js' / 'config.js'
SERVICE_WORKER = ROOT / 'service-worker.js'
TEXT_FILES = [
    INVENTARIO / 'inventario-el-hornero.csv',
    INVENTARIO / 'manifest-imagenes.json',
    INVENTARIO / 'atribuciones-imagenes.txt',
    INVENTARIO / 'busqueda-fotografias.txt',
    INVENTARIO / 'pendientes-imagenes.csv',
]
EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp'}
LOGO_NAMES = {'logo.png'}
MIME = {'JPEG': 'image/jpeg', 'WEBP': 'image/webp', 'PNG': 'image/png'}
EXT = {'JPEG': '.jpg', 'WEBP': '.webp', 'PNG': '.png'}
FORMAT_BY_SUFFIX = {'.jpg': 'JPEG', '.jpeg': 'JPEG', '.png': 'PNG', '.webp': 'WEBP'}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def has_transparency(image: Image.Image) -> bool:
    if image.mode not in ('RGBA', 'LA', 'PA') and not (image.mode == 'P' and 'transparency' in image.info):
        return False
    return image.convert('RGBA').getchannel('A').getextrema()[0] < 250


def optimize(data: bytes, max_side: int, quality: int, is_logo: bool = False) -> tuple[bytes, str]:
    """Devuelve (bytes optimizados, formato PIL)."""
    image = Image.open(io.BytesIO(data))
    image = ImageOps.exif_transpose(image)
    limit = max(max_side, 1200) if is_logo else max_side
    if max(image.size) > limit:
        image.thumbnail((limit, limit), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    if is_logo:
        fmt = 'PNG'
        image.convert('RGBA').save(out, fmt, optimize=True)
    elif has_transparency(image):
        fmt = 'WEBP'
        image.convert('RGBA').save(out, fmt, quality=quality, method=6)
    else:
        fmt = 'JPEG'
        rgba = image.convert('RGBA')
        background = Image.new('RGB', rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel('A'))
        background.save(out, fmt, quality=quality, optimize=True, progressive=True)
    return out.getvalue(), fmt


def decode_data_url(url: str) -> bytes:
    return base64.b64decode(url.split(',', 1)[1])


def encode_data_url(data: bytes, fmt: str) -> str:
    return f'data:{MIME[fmt]};base64,{base64.b64encode(data).decode("ascii")}'


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--max', type=int, default=900, help='lado mayor máximo en píxeles (900)')
    parser.add_argument('--calidad', type=int, default=82, help='calidad JPEG/WebP de 1 a 100 (82)')
    parser.add_argument('--simular', action='store_true', help='no modifica archivos')
    args = parser.parse_args()

    files = sorted(p for p in IMAGENES.iterdir() if p.is_file() and p.suffix.lower() in EXTENSIONS)
    taken = {p.name.lower() for p in files}
    results = {}  # sha256 original -> (bytes finales, formato o None si no cambió)
    renames = {}  # nombre viejo -> nombre nuevo
    plan = []
    before = after = 0

    for path in files:
        original = path.read_bytes()
        new, fmt = optimize(original, args.max, args.calidad, path.name.lower() in LOGO_NAMES)
        target = path.name
        if FORMAT_BY_SUFFIX[path.suffix.lower()] != fmt:
            target = path.stem + EXT[fmt]
            if target.lower() in taken:
                target = f'{path.stem}-opt{EXT[fmt]}'
            if target.lower() in taken:
                new, fmt, target = original, None, path.name
            else:
                taken.add(target.lower())
        if fmt and target == path.name and len(new) >= len(original):
            new, fmt = original, None  # ya estaba optimizada
        results[sha256(original)] = (new, fmt)
        if target != path.name:
            renames[path.name] = target
        plan.append((path, target, new))
        before += len(original)
        after += len(new)

    print(f'Fotos: {len(files)}  |  antes: {before / 1e6:.1f} MB  ->  después: {after / 1e6:.1f} MB '
          f'({100 - after * 100 / max(before, 1):.0f}% menos)  |  cambios de extensión: {len(renames)}')
    if args.simular:
        return

    stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S')
    backup_dir = ROOT.parent / f'{ROOT.name}-originales-{stamp}'
    shutil.copytree(IMAGENES, backup_dir / 'imagenes')
    for extra in [RESPALDO, ACTUALIZACION, CONFIG, SERVICE_WORKER, *TEXT_FILES]:
        if extra.exists():
            shutil.copy2(extra, backup_dir / extra.name)
    print(f'Respaldo de originales: {backup_dir}')

    for path, target, new in plan:
        if target != path.name:
            path.unlink()
        (IMAGENES / target).write_bytes(new)

    for text_file in TEXT_FILES:
        if not text_file.exists():
            continue
        content = text_file.read_bytes()
        for old, new_name in renames.items():
            content = content.replace(f'imagenes/{old}'.encode('utf-8'), f'imagenes/{new_name}'.encode('utf-8'))
        text_file.write_bytes(content)

    raw = RESPALDO.read_text(encoding='utf-8')
    backup = json.loads(raw)
    updates = []
    for product in backup['products']:
        if not product.get('image'):
            continue
        old_bytes = decode_data_url(product['image'])
        key = sha256(old_bytes)
        if key not in results:
            new_bytes, fmt = optimize(old_bytes, args.max, args.calidad)
            results[key] = (new_bytes, fmt) if len(new_bytes) < len(old_bytes) else (old_bytes, None)
        new_bytes, fmt = results[key]
        if fmt is None or new_bytes == old_bytes:
            continue
        product['image'] = encode_data_url(new_bytes, fmt)
        updates.append({'id': product['id'], 'updatedAt': product['updatedAt'], 'previousImageSha256': key})
    if backup.get('logo'):
        old_logo = decode_data_url(backup['logo'])
        new_logo, fmt = optimize(old_logo, args.max, args.calidad, True)
        if len(new_logo) < len(old_logo):
            backup['logo'] = encode_data_url(new_logo, fmt)
    RESPALDO.write_text(json.dumps(backup, ensure_ascii=False, indent=2) + ('\n' if raw.endswith('\n') else ''),
                        encoding='utf-8')
    print(f'Respaldo incluido: {len(raw.encode("utf-8")) / 1e6:.1f} MB -> {RESPALDO.stat().st_size / 1e6:.1f} MB')

    if updates:
        version = f'{dt.date.today().isoformat()}-opt{len(updates)}'
        ACTUALIZACION.write_text(json.dumps({'version': version, 'updates': updates}, ensure_ascii=False, indent=2) + '\n',
                                 encoding='utf-8')
        config = CONFIG.read_text(encoding='utf-8')
        CONFIG.write_text(re.sub(r"photoUpdateVersion: '[^']*'", f"photoUpdateVersion: '{version}'", config),
                          encoding='utf-8')
        print(f'Actualización de fotografías {version}: {len(updates)} productos')

    worker = SERVICE_WORKER.read_text(encoding='utf-8')
    worker = re.sub(r'hornero-shell-v(\d+)', lambda m: f'hornero-shell-v{int(m.group(1)) + 1}', worker, count=1)
    SERVICE_WORKER.write_text(worker, encoding='utf-8')
    print('Listo. Recargá el sitio para que el navegador tome las fotos livianas.')


if __name__ == '__main__':
    main()
