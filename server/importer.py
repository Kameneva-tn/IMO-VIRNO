# -*- coding: utf-8 -*-
"""Розбір таблиці з картками товарів і злиття з каталогом сайту.

Використовують і tools/import_xlsx.py (командний рядок), і адмінка (server/app.py).
"""
import json, re, subprocess
from pathlib import Path

import pandas as pd
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
IMG_DIR = ROOT / "assets" / "img"
DATA = ROOT / "assets" / "data" / "products.json"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125.0 Safari/537.36"

# Чотири великі групи для фільтра вгорі сайту.
BIG_GROUPS = [
    ("food",   "Їжа"),
    ("drinks", "Напої"),
    ("care",   "Краса та здоров'я"),
    ("home",   "Дім і побут"),
]

# 26 категорій із каталогу магазину → велика група.
CATEGORIES = {
    "Молочні продукти та сири": "food",
    "М'ясні продукти та ковбаси": "food",
    "Риба та морепродукти": "food",
    "Яйця": "food",
    "Морозиво": "food",
    "Кондитерські вироби та солодощі": "food",
    "Хліб, хлібці, снеки та безглютенова випічка": "food",
    "Бакалія, крупи, макарони": "food",
    "Спеції, приправи та трави": "food",
    "Олії, соуси, оцти та цукор": "food",
    "Джеми, пюре, мед, горіхові пасти": "food",
    "Насіння, горіхи та сухофрукти": "food",
    "Консервація, оливки та овочі": "food",
    "Заморожені продукти та напівфабрикати": "food",
    "Готові страви та кулінарія": "food",
    "Веганські та рослинні альтернативи": "food",
    "Овочі, фрукти та зелень": "food",
    "Чай, кава, какао": "drinks",
    "Безалкогольні напої та вода": "drinks",
    "Алкогольні напої": "drinks",
    "Краса та догляд": "care",
    "Ефірні олії, свічки та аромати": "care",
    "Дієтичні добавки, вітаміни та суперфуди": "care",
    "Засоби побутового призначення": "home",
    "Одяг, взуття та аксесуари": "home",
    "Подарунки, декор та посуд": "home",
}


def group_of_category(category: str) -> str:
    """Велика група для категорії з таблиці."""
    if category in CATEGORIES:
        return CATEGORIES[category]
    low = (category or "").lower()
    for name, key in CATEGORIES.items():          # спроба знайти за частиною назви
        if low and (low in name.lower() or name.lower().startswith(low[:12])):
            return key
    return "food"


def label_of(key):
    return next((l for k, l in BIG_GROUPS if k == key), "Їжа")


# Назви колонок різняться від файлу до файлу, тож звіряємо їх «на око»:
# регістр, дужки та хвости на кшталт «— заповнити» ігноруються.
COLS = {
    "code":    ["коди усі розміри", "коди", "код", "артикул"],
    "name":    ["назва для картки виправлена", "назва для картки", "назва товару", "назва"],
    "brand":   ["бренд тм", "бренд", "тм"],
    "pack":    ["фасування з файлу", "фасування", "об'єм", "вага"],
    "price":   ["ціна грн", "ціна uah", "ціна роздрібна", "ціна"],
    "ean":     ["штрихкод", "ean"],
    "desc":    ["опис для картки", "опис чернетка", "опис"],
    "sostav":  ["матеріал склад", "склад", "матеріал"],
    "nutri":   ["харчова цінність 100 г", "харчова цінність на 100 г", "харчова цінність"],
    "photo":   ["фото url", "фото посилання", "фото"],
    "photo2":  ["фото альтернатива", "фото 2"],
    "country": ["країна виправлена", "країна"],
    "storage": ["зберігання", "умови зберігання"],
    "note":    ["що перевірити виправити", "що перевірити", "статус", "примітка"],
    "sizes":   ["розміри", "розмір", "наявні розміри"],
    "colors":  ["кольори", "колір", "наявні кольори"],
    "chart":   ["таблиця розмірів", "розмірна сітка"],
}


def norm_col(name: str) -> str:
    s = str(name).lower().replace("ё", "е")
    s = re.sub(r"\(.*?\)", " ", s)                 # прибираємо дужки
    s = re.split(r"[—–]|\s-\s", s)[0]              # і хвости на кшталт «— заповнити»
    s = re.sub(r"[^a-zа-яіїєґ0-9'\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def cell(row, key):
    wanted = COLS[key]
    for col in row.index:
        n = norm_col(col)
        if any(n == w or n.startswith(w + " ") or w == n.replace(" ", "") for w in wanted):
            if pd.notna(row[col]):
                return row[col]
    return None


def parse_price(value):
    """«3812», «1 250,50», «109–124» (ціна залежить від розміру) → (число, підпис)."""
    nums = [float(x.replace(",", ".")) for x in
            re.findall(r"\d+(?:[.,]\d+)?", str(value).replace(" ", "").replace("\u00a0", ""))]
    if not nums:
        return None, ""
    if len(nums) > 1 and max(nums) != min(nums):
        return int(min(nums)), f"від {int(min(nums))} до {int(max(nums))} грн залежно від розміру"
    return int(nums[0]), ""


def first_code(value) -> str | None:
    """«13467, 13469» → 13467 (одна картка на всі розміри)."""
    m = re.search(r"\d+", str(value))
    return m.group(0) if m else None


def short_name(full, brand, pack):
    s = str(full)
    if brand:
        s = re.sub(re.escape(str(brand)), "", s, flags=re.I)
    s = re.sub(r"\(.*?\)", "", s)
    for _ in range(3):
        s = re.sub(r",?\s*(\d+[,.]?\d*\s*(г|кг|мл|л|шт)\b\.?)\s*$", "", s, flags=re.I)
        s = re.sub(r",?\s*(ваговий|скло|у склі)\s*$", "", s, flags=re.I).strip(" ,")
    s = re.sub(r"\s+,", ",", s)
    return re.sub(r"\s{2,}", " ", s).strip(" ,·-–") or str(full)


def wrap(s):
    words = s.split()
    if len(words) < 3:
        return s
    total, acc, best = len(s), 0, None
    for i, w in enumerate(words[:-1]):
        acc += len(w) + 1
        d = abs(acc - total / 2)
        if best is None or d < best[0]:
            best = (d, i)
    return " ".join(words[:best[1] + 1]) + "\n" + " ".join(words[best[1] + 1:])


def save_image(source: bytes | str, code: str) -> str | None:
    """Кладе фото в assets/img як webp. Приймає байти або URL."""
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    raw = IMG_DIR / f"tmp_{code}"
    if isinstance(source, bytes):
        raw.write_bytes(source)
    else:
        subprocess.run(["curl", "-sL", "--max-time", "40", "-A", UA, "-o", str(raw), source], check=False)
    if not raw.exists() or raw.stat().st_size < 3000:
        raw.unlink(missing_ok=True)
        return None
    try:
        im = Image.open(raw).convert("RGBA")
    except Exception:
        raw.unlink(missing_ok=True)
        return None
    bg = Image.new("RGB", im.size, (255, 255, 255))
    bg.paste(im, mask=im.split()[3])
    w, h = bg.size
    if max(w, h) > 700:
        k = 700 / max(w, h)
        bg = bg.resize((int(w * k), int(h * k)), Image.LANCZOS)
    # у назві — відбиток вмісту: нове фото отримує нову адресу,
    # і браузери не показують стару копію з кешу
    import hashlib, io
    buf = io.BytesIO()
    bg.save(buf, "WEBP", quality=72, method=6)
    data = buf.getvalue()
    name = f"z{code}-{hashlib.md5(data).hexdigest()[:8]}"
    for old in IMG_DIR.glob(f"z{code}*.webp"):
        if old.stem != name and (old.stem == f"z{code}" or old.stem.startswith(f"z{code}-")):
            old.unlink(missing_ok=True)
    (IMG_DIR / f"{name}.webp").write_bytes(data)
    raw.unlink(missing_ok=True)
    return name


# Позначки на картках: ключ, підпис, слова-ознаки в назві/складі/описі
TAGS = [
    ("vegan",   "Веган",        ["рослинн", "vegetus", "violife", "сейтан", "веган", "nature's charm",
                                  "кокосов", "вівсян", "соєв", "&joy", "bifood", "bi food", "мигдал", "тофу"]),
    ("nolact",  "Без лактози",  ["без лактоз", "безлактоз", "lactose free", "lactose-free"]),
    ("nogluten","Без глютену",  ["без глютен", "безглютен", "gluten free", "gluten-free"]),
    ("nosugar", "Без цукру",    ["без цукру", "безцукров", "без доданого цукру", "sugar free",
                                  "еритритол", "стевія", "підсолоджувач"]),
    ("hemp",    "Конопляне",    ["конопл", "hemp"]),
    ("farm",    "Фермерське",   ["фермерськ", "фермерське", "власного стада", "сімейн" "ої ферми", "крафтов"]),
]


# Категорії, де покупець обирає розмір і/або колір
VARIANT_CATEGORIES = {"Одяг, взуття та аксесуари"}


def split_list(value) -> list:
    """«S, M, L» або «S / M / L» або «42-46» → список значень."""
    if value is None:
        return []
    raw = str(value).replace("\n", ",").replace(";", ",").replace("/", ",").replace("|", ",")
    out = []
    for part in raw.split(","):
        part = part.strip(" .")
        if part and part.lower() not in ("nan", "-", "—"):
            out.append(part)
    seen, uniq = set(), []
    for x in out:
        if x.lower() not in seen:
            seen.add(x.lower())
            uniq.append(x)
    return uniq[:20]


def tags_of(item) -> list:
    hay = " ".join(str(item.get(k) or "") for k in
                   ("name", "sub", "brand", "desc", "sostav", "cat_name")).lower()
    hay += " " + " ".join(str(x).lower() for x in (item.get("comp") or []))
    found = []
    for key, _label, words in TAGS:
        if key == "vegan" and item.get("cat_name") == "Веганські та рослинні альтернативи":
            found.append(key)
            continue
        if any(w in hay for w in words):
            found.append(key)
    return found


def tag_label(key):
    return next((l for k, l, _ in TAGS if k == key), key)


VEGAN_KEYS = ["рослинн", "vegetus", "violife", "сейтан", "веган", "nature's charm",
              "кокосов", "вівсян", "соєв", "&joy", "bifood", "bi food", "мигдал", "тофу"]


def is_vegan(item) -> bool:
    if item.get("cat_name") == "Веганські та рослинні альтернативи":
        return True
    hay = " ".join(str(item.get(k) or "") for k in ("name", "sub", "brand", "desc", "sostav")).lower()
    return any(k in hay for k in VEGAN_KEYS)


# ── назви файлів фото: бренд_категорія_назва_штрихкод_код ──
_TR = {"а":"a","б":"b","в":"v","г":"h","ґ":"g","д":"d","е":"e","є":"ie","ж":"zh","з":"z","и":"y",
       "і":"i","ї":"i","й":"i","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t",
       "у":"u","ф":"f","х":"kh","ц":"ts","ч":"ch","ш":"sh","щ":"shch","ь":"","ю":"iu","я":"ia",
       "ы":"y","э":"e","ъ":"","ё":"e","'":"","’":"","ʼ":"","`":""}


def slug(text: str, limit: int = 60) -> str:
    s = "".join(_TR.get(ch, ch) for ch in str(text or "").lower())
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:limit].strip("-") or "bez-nazvy"


def photo_basename(item: dict) -> str:
    parts = [slug(item.get("brand") or "bez-tm", 30),
             slug(item.get("cat_name") or item.get("cat") or "kategoriia", 40),
             slug((item.get("name") or "").replace("\n", " "), 70),
             re.sub(r"\D", "", str(item.get("ean") or "")) or "bez-shtrykhkodu",
             re.sub(r"[^0-9A-Za-z-]", "", str(item.get("id")))]
    return "_".join(parts)[:200]


def save_named_image(data: bytes, item: dict):
    """Фото товару з «людською» назвою файлу. Повертає (назва, версія для кешу)."""
    import hashlib, io
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    try:
        im = Image.open(io.BytesIO(data)).convert("RGBA")
    except Exception:
        return None, None
    bg = Image.new("RGB", im.size, (255, 255, 255))
    bg.paste(im, mask=im.split()[3])
    w, h = bg.size
    if max(w, h) > 900:
        k = 900 / max(w, h)
        bg = bg.resize((int(w * k), int(h * k)), Image.LANCZOS)
    buf = io.BytesIO()
    bg.save(buf, "WEBP", quality=78, method=6)
    out = buf.getvalue()
    name = photo_basename(item)
    old = item.get("img")
    (IMG_DIR / f"{name}.webp").write_bytes(out)
    if old and old != name and not str(old).startswith("p") and not str(old).startswith("sec-"):
        (IMG_DIR / f"{old}.webp").unlink(missing_ok=True)
    return name, hashlib.md5(out).hexdigest()[:8]


def load_products():
    return json.loads(DATA.read_text(encoding="utf-8"))


def save_products(products):
    DATA.write_text(json.dumps(products, ensure_ascii=False, indent=1), encoding="utf-8")


def import_table(xlsx, category="", sheet=0, dry_run=False, with_photos=True, log=print):
    """Читає таблицю й доповнює каталог. Повертає підсумок."""
    if category and category not in CATEGORIES:
        raise ValueError(f"Невідома категорія: {category}")
    table = pd.read_excel(xlsx, sheet_name=sheet)
    products = load_products()
    by_id = {p["id"]: p for p in products}
    added, updated, missing = [], [], []

    for _, row in table.iterrows():
        raw_code = cell(row, "code")
        full = cell(row, "name")
        price = cell(row, "price")
        code = first_code(raw_code) if raw_code is not None else None
        price_value, price_note = parse_price(price)
        if not code or not full or price_value is None:
            continue
        codes = [c for c in re.findall(r"\d+", str(raw_code))]
        brand = str(cell(row, "brand") or "БЕЗ ТМ").strip()
        pack = cell(row, "pack")
        country = cell(row, "country")
        old = by_id.get(code, {})

        image = old.get("img")
        url = cell(row, "photo") or cell(row, "photo2")
        if url and not image and with_photos and not dry_run:
            image = save_image(str(url), code)
            log(("фото: " if image else "фото не завантажилось: ") + code)
        if not image:
            missing.append({"id": code, "name": short_name(full, brand, pack)})

        facts = []
        if cell(row, "nutri"):
            facts += [p.strip() for p in str(cell(row, "nutri")).split(";") if p.strip()]
        if cell(row, "storage"):
            facts.append("Зберігати " + str(cell(row, "storage")))
        if country:
            facts.append("Країна: " + str(country).replace(" (уточнити)", ""))
        if len(facts) < 3:
            facts.append("ТМ " + brand)

        cat_name = category or old.get("cat_name") or "Молочні продукти та сири"
        group = group_of_category(cat_name)
        note = str(cell(row, "note") or "")
        item = {
            "id": code,
            "img": image,
            "full": bool(image and str(image).startswith("z")),
            "brand": brand.upper(),
            "cat": cat_name.upper(),
            "cat_name": cat_name,
            "g": group,
            "price": price_value,
            "pop": old.get("pop", len(products) + len(added)),
            "tag": price_note or old.get("tag", ""),
            "name": wrap(short_name(full, brand, pack)),
            "sub": " · ".join(x for x in [brand, str(pack) if pack else None,
                                          str(country) if country else None] if x),
            "desc": str(cell(row, "desc") or ""),
            "sostav": str(cell(row, "sostav")) if cell(row, "sostav") else None,
            "comp": facts[:6],
            "ean": str(int(cell(row, "ean"))) if cell(row, "ean") else None,
            "weighted": bool(re.search(r"ціна за 1 ?кг", note, re.I)),
            "codes": codes,
            "note": note or None,
            "sect": cat_name.upper(),
        }
        sizes = split_list(cell(row, "sizes"))
        colors = split_list(cell(row, "colors"))
        chart = cell(row, "chart")
        item["sizes"] = sizes or old.get("sizes") or []
        item["colors"] = colors or old.get("colors") or []
        item["size_chart"] = (str(chart) if chart else None) or old.get("size_chart")
        item["needs_choice"] = bool(item["sizes"] or item["colors"]) or cat_name in VARIANT_CATEGORIES
        item["tags"] = tags_of(item)
        item["vegan"] = "vegan" in item["tags"]
        if item["ean"] and len(item["ean"]) == 12:
            item["ean"] = "0" + item["ean"]

        if code in by_id:
            if not dry_run:
                by_id[code].update(item)
            updated.append(code)
        else:
            if not dry_run:
                products.append(item)
                by_id[code] = item
            added.append(code)

    if not dry_run:
        save_products(products)

    return {"added": len(added), "updated": len(updated), "missing_photo": missing,
            "total": len(products) + (0 if not dry_run else len(added)),
            "dry_run": dry_run, "category": category}
