import csv
import os
import re
import time
import unicodedata
import requests
from ddgs import DDGS

# --------------------------------------------------
# CONFIGURATION
# --------------------------------------------------

CSV_FILE = "pendientes-imagenes.csv"
OUTPUT_DIR = "imagenes"
RESULTS_CSV = "resultado-descarga.csv"

# The uploaded CSV uses these exact column names.
TITLE_COLUMN = "title"
BRAND_COLUMN = "brand"
CATEGORY_COLUMN = "category"

MAX_RESULTS = 8
DELAY_SECONDS = 2
REQUEST_TIMEOUT = 25

os.makedirs(OUTPUT_DIR, exist_ok=True)


def slugify(value):
    """Create a filesystem-safe filename while keeping readable words."""
    value = unicodedata.normalize("NFKD", str(value))
    value = value.encode("ascii", "ignore").decode("ascii")
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "producto"


def existing_image(base_name):
    """Return True if an image with this base filename already exists."""
    valid_extensions = (".jpg", ".jpeg", ".png", ".webp")
    return any(
        os.path.isfile(os.path.join(OUTPUT_DIR, base_name + ext))
        for ext in valid_extensions
    )


def get_extension(response):
    """Determine image extension from the HTTP Content-Type."""
    content_type = response.headers.get("Content-Type", "")
    content_type = content_type.split(";")[0].strip().lower()

    extensions = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
    }
    return extensions.get(content_type)


def download_image(image_url, base_name):
    """Download an image only if the response is a supported image."""
    try:
        response = requests.get(
            image_url,
            timeout=REQUEST_TIMEOUT,
            headers={"User-Agent": "Mozilla/5.0"}
        )
        response.raise_for_status()

        extension = get_extension(response)
        if not extension or len(response.content) < 5_000:
            return None

        # Avoid overwriting an existing file with the same name.
        filepath = os.path.join(OUTPUT_DIR, base_name + extension)
        if os.path.exists(filepath):
            return filepath

        with open(filepath, "wb") as image_file:
            image_file.write(response.content)

        return filepath

    except requests.RequestException:
        return None


def build_search_query(product):
    """Build a more specific query from title, brand and category."""
    title = (product.get(TITLE_COLUMN) or "").strip()
    brand = (product.get(BRAND_COLUMN) or "").strip()
    category = (product.get(CATEGORY_COLUMN) or "").strip()

    parts = [title, brand, category, "producto envase"]
    return " ".join(part for part in parts if part)


def search_and_download(product):
    title = (product.get(TITLE_COLUMN) or "").strip()
    brand = (product.get(BRAND_COLUMN) or "").strip()
    category = (product.get(CATEGORY_COLUMN) or "").strip()

    if not title:
        return {
            "title": title,
            "brand": brand,
            "category": category,
            "status": "SKIPPED - título vacío",
            "image": "",
            "image_url": "",
        }

    base_name = slugify(title)

    if existing_image(base_name):
        print(f"[SKIP] Ya existe: {title}")
        return {
            "title": title,
            "brand": brand,
            "category": category,
            "status": "SKIPPED - ya existía",
            "image": "",
            "image_url": "",
        }

    query = build_search_query(product)
    print(f"[SEARCH] {query}")

    try:
        with DDGS() as ddgs:
            results = list(ddgs.images(query, max_results=MAX_RESULTS))

        for result in results:
            image_url = result.get("image")
            if not image_url:
                continue

            filepath = download_image(image_url, base_name)
            if filepath:
                image_name = os.path.basename(filepath)
                print(f"[OK] {image_name}")

                return {
                    "title": title,
                    "brand": brand,
                    "category": category,
                    "status": "DOWNLOADED",
                    "image": image_name,
                    "image_url": image_url,
                }

        print(f"[NOT FOUND] {title}")
        status = "NOT FOUND - no se encontró imagen válida"

    except Exception as error:
        print(f"[ERROR] {title}: {error}")
        status = f"ERROR - {str(error)}"

    return {
        "title": title,
        "brand": brand,
        "category": category,
        "status": status,
        "image": "",
        "image_url": "",
    }


def main():
    if not os.path.isfile(CSV_FILE):
        print(f"No se encontró el archivo: {CSV_FILE}")
        return

    # utf-8-sig handles CSV files exported with a UTF-8 BOM.
    with open(CSV_FILE, "r", encoding="utf-8-sig", newline="") as csv_file:
        reader = csv.DictReader(csv_file)

        required_columns = {TITLE_COLUMN, BRAND_COLUMN, CATEGORY_COLUMN}
        available_columns = set(reader.fieldnames or [])
        missing = required_columns - available_columns

        if missing:
            print("Faltan columnas en el CSV:", ", ".join(sorted(missing)))
            print("Columnas encontradas:", reader.fieldnames)
            return

        products = list(reader)

    total = len(products)
    print(f"Productos encontrados: {total}")
    print(f"Carpeta de salida: {OUTPUT_DIR}/\n")

    results = []

    for index, product in enumerate(products, start=1):
        print(f"\n[{index}/{total}]")
        results.append(search_and_download(product))
        time.sleep(DELAY_SECONDS)

    # Save a report with the result and original image URL for each product.
    fieldnames = [
        "title", "brand", "category",
        "status", "image", "image_url"
    ]

    with open(RESULTS_CSV, "w", encoding="utf-8-sig", newline="") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(results)

    downloaded = sum(row["status"] == "DOWNLOADED" for row in results)
    not_found = sum(row["status"].startswith("NOT FOUND") for row in results)
    skipped = sum(row["status"].startswith("SKIPPED") for row in results)
    errors = sum(row["status"].startswith("ERROR") for row in results)

    print("\n--------------- SUMMARY ---------------")
    print(f"Total:       {total}")
    print(f"Descargadas: {downloaded}")
    print(f"No halladas: {not_found}")
    print(f"Omitidas:    {skipped}")
    print(f"Errores:     {errors}")
    print(f"\nImágenes: {OUTPUT_DIR}/")
    print(f"Reporte:   {RESULTS_CSV}")


if __name__ == "__main__":
    main()
