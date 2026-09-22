#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Імпорт категорії з Excel у каталог сайту (командний рядок).

    python3 tools/import_xlsx.py ~/Downloads/Риба_картки.xlsx --category "Риба та морепродукти"

Те саме робить адмінка на /admin/ — там файл просто перетягують у форму.
"""
import argparse, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from server import importer
except ImportError as e:
    sys.exit(f"Потрібні пакети: pip3 install pandas openpyxl pillow ({e})")

ap = argparse.ArgumentParser()
ap.add_argument("xlsx")
ap.add_argument("--category", required=True, help="категорія з каталогу, напр. \"Риба та морепродукти\"")
ap.add_argument("--sheet", default=0)
ap.add_argument("--dry-run", action="store_true", help="лише показати, що буде зроблено")
ap.add_argument("--skip-photos", action="store_true")
a = ap.parse_args()

r = importer.import_table(a.xlsx, a.category, a.sheet, a.dry_run, not a.skip_photos)
print(f"\nДодано: {r['added']}, оновлено: {r['updated']}, без фото: {len(r['missing_photo'])}.")
for p in r["missing_photo"][:20]:
    print("  без фото:", p["id"], p["name"].replace("\n", " "))
if not a.dry_run:
    print("\nДалі: SERVER=root@IP ./deploy/deploy.sh")
