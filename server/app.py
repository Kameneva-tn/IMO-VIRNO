"""ЇМО ВІРНО — приймання замовлень із сайту.

Приймає POST /api/order, перевіряє дані, перераховує суму за власним
каталогом (ціни з браузера не приймаємо), зберігає замовлення у файл
і надсилає його в Telegram адміну.
"""
import json, os, re, time, asyncio, logging
from pathlib import Path
from collections import defaultdict, deque

import hmac, hashlib, secrets, shutil, tempfile
import httpx
from fastapi import FastAPI, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from server import importer, assistant

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("ORDERS_DIR", "/var/lib/imo-virno"))
PRODUCTS = ROOT / "assets" / "data" / "products.json"

TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
CHAT_ID = os.getenv("ADMIN_CHAT_ID", "").strip()
FREE_FROM = int(os.getenv("FREE_FROM", "999"))
SHIPPING = int(os.getenv("SHIPPING", "49"))
SERVE_STATIC = os.getenv("SERVE_STATIC", "0") == "1"
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "").strip()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("imo-virno")

app = FastAPI(title="ЇМО ВІРНО — замовлення", docs_url=None, redoc_url=None)

HOW = {"courier": "Кур'єр", "pickup": "Самовивіз", "np": "Нова Пошта"}
PHONE_RE = re.compile(r"^\+?[\d\s()\-]{10,20}$")
_hits = defaultdict(deque)          # проста заслінка від флуду: 5 замовлень / 10 хв з IP


def catalog() -> dict:
    with PRODUCTS.open(encoding="utf-8") as f:
        return {p["id"]: p for p in json.load(f)}


def too_often(ip: str) -> bool:
    now = time.time()
    q = _hits[ip]
    while q and now - q[0] > 600:
        q.popleft()
    if len(q) >= 5:
        return True
    q.append(now)
    return False


def clean(value, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


async def notify(text: str) -> bool:
    if not TOKEN or not CHAT_ID:
        log.warning("Telegram не налаштовано — замовлення лише збережено у файл")
        return False
    url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    payload = {"chat_id": CHAT_ID, "text": text, "parse_mode": "HTML"}
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.post(url, json=payload)
            if r.status_code == 200:
                return True
            log.error("Telegram %s: %s", r.status_code, r.text[:200])
        except Exception as e:                       # мережа могла моргнути
            log.error("Telegram помилка: %s", e)
        await asyncio.sleep(2 * (attempt + 1))
    return False


@app.get("/api/health")
async def health():
    return {"ok": True, "products": len(catalog()), "telegram": bool(TOKEN and CHAT_ID)}


@app.post("/api/order")
async def order(request: Request):
    ip = request.headers.get("x-real-ip") or (request.client.host if request.client else "?")
    if too_often(ip):
        return JSONResponse({"ok": False, "error": "Забагато замовлень поспіль. Спробуйте за кілька хвилин."}, 429)

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "Некоректний запит"}, 400)

    if clean(body.get("website"), 50):               # приманка для ботів
        return {"ok": True, "number": "ЇВ-000000"}

    name = clean(body.get("name"), 80)
    phone = clean(body.get("phone"), 25)
    addr = clean(body.get("addr"), 200)
    slot = clean(body.get("slot"), 60)
    note = clean(body.get("note"), 500)
    how = body.get("how") if body.get("how") in HOW else "courier"

    problems = []
    if len(name) < 2:
        problems.append("ім'я")
    if not PHONE_RE.match(phone):
        problems.append("телефон")
    if len(addr) < 3:
        problems.append("адресу")
    if problems:
        return JSONResponse({"ok": False, "error": "Заповніть " + ", ".join(problems)}, 400)

    goods = catalog()
    items, total = [], 0
    for raw in (body.get("items") or [])[:60]:
        pid = str(raw.get("id"))
        qty = int(raw.get("qty") or 0)
        product = goods.get(pid)
        if not product or not 1 <= qty <= 99:
            continue
        size = clean(raw.get("size"), 40)
        color = clean(raw.get("color"), 40)
        if product.get("sizes") and size not in product["sizes"]:
            size = ""
        if product.get("colors") and color not in product["colors"]:
            color = ""
        if product.get("needs_choice") and (product.get("sizes") and not size or product.get("colors") and not color):
            return JSONResponse({"ok": False, "error": f"Оберіть розмір і колір: {product['name'].replace(chr(10), ' ')}"}, 400)
        line = product["price"] * qty
        total += line
        items.append({"id": pid, "name": product["name"].replace("\n", " "),
                      "sub": product["sub"], "qty": qty, "price": product["price"], "sum": line,
                      "size": size, "color": color})
    if not items:
        return JSONResponse({"ok": False, "error": "Кошик порожній"}, 400)

    shipping = 0 if (total >= FREE_FROM or how == "pickup") else SHIPPING
    number = "ЇВ-" + str(int(time.time()))[-6:]
    record = {"number": number, "created": time.strftime("%Y-%m-%d %H:%M:%S"), "ip": ip,
              "name": name, "phone": phone, "how": HOW[how], "addr": addr, "slot": slot,
              "note": note, "items": items, "goods_sum": total, "shipping": shipping,
              "total": total + shipping}

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with (DATA_DIR / "orders.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")

    lines = [f"🧀 <b>Замовлення {number}</b>", "",
             f"<b>{name}</b>, {phone}",
             f"{HOW[how]}: {addr}",
             f"Час: {slot or '—'}", ""]
    lines += [f"• {i['name']}{(' · ' + ' / '.join(x for x in (i.get('size'), i.get('color')) if x)) if (i.get('size') or i.get('color')) else ''}"
              f" — {i['qty']} × {i['price']} = {i['sum']} грн" for i in items]
    lines += ["", f"Товари: {total} грн", f"Доставка: {shipping} грн", f"<b>Разом: {record['total']} грн</b>"]
    if note:
        lines += ["", f"Коментар: {note}"]
    sent = await notify("\n".join(lines))

    log.info("Замовлення %s на %s грн, telegram=%s", number, record["total"], sent)
    return {"ok": True, "number": number, "total": record["total"], "shipping": shipping}




# ─────────────────────────── адмінка ───────────────────────────

_login_tries = defaultdict(deque)


def make_token(hours: int = 12) -> str:
    exp = str(int(time.time()) + hours * 3600)
    sig = hmac.new(ADMIN_PASSWORD.encode(), exp.encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{sig}"


def token_ok(token: str) -> bool:
    if not ADMIN_PASSWORD or not token or "." not in token:
        return False
    exp, sig = token.rsplit(".", 1)
    if not exp.isdigit() or int(exp) < time.time():
        return False
    good = hmac.new(ADMIN_PASSWORD.encode(), exp.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, good)


def guard(request: Request):
    """Повертає None, якщо доступ дозволено, інакше готову відповідь 401."""
    if token_ok(request.cookies.get("imo_admin", "")):
        return None
    return JSONResponse({"ok": False, "error": "Потрібен вхід"}, 401)


@app.post("/api/admin/login")
async def admin_login(request: Request):
    ip = request.headers.get("x-real-ip") or (request.client.host if request.client else "?")
    tries = _login_tries[ip]
    now = time.time()
    while tries and now - tries[0] > 900:
        tries.popleft()
    if len(tries) >= 8:
        return JSONResponse({"ok": False, "error": "Забагато спроб. Зачекайте 15 хвилин."}, 429)

    if not ADMIN_PASSWORD:
        return JSONResponse({"ok": False, "error": "ADMIN_PASSWORD не заданий у .env на сервері"}, 500)

    body = await request.json()
    given = str(body.get("password", "")).encode("utf-8")
    if not secrets.compare_digest(given, ADMIN_PASSWORD.encode("utf-8")):
        tries.append(now)
        return JSONResponse({"ok": False, "error": "Невірний пароль"}, 401)

    resp = JSONResponse({"ok": True})
    resp.set_cookie("imo_admin", make_token(), max_age=12 * 3600, httponly=True,
                    samesite="strict", path="/")
    return resp


@app.post("/api/admin/logout")
async def admin_logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("imo_admin", path="/")
    return resp


@app.post("/api/assistant")
async def assistant_chat(request: Request):
    ip = request.headers.get("x-real-ip") or (request.client.host if request.client else "?")
    if assistant.too_often(ip):
        return JSONResponse({"ok": False, "error": "Забагато повідомлень поспіль. Зачекайте кілька хвилин."}, 429)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "Некоректний запит"}, 400)
    try:
        result = await assistant.chat(body.get("history") or [])
    except Exception as e:
        log.exception("Помічник: помилка")
        return JSONResponse({"ok": False, "error": "Помічник зараз недоступний. Спробуйте за хвилину."}, 502)
    return {"ok": True, **result}


@app.get("/api/admin/me")
async def admin_me(request: Request):
    # без 401, щоб у звичайних відвідувачів не сипались помилки в консоль
    return {"ok": True, "admin": token_ok(request.cookies.get("imo_admin", ""))}


@app.get("/api/admin/categories")
async def admin_categories(request: Request):
    if (deny := guard(request)):
        return deny
    return {"ok": True, "groups": [{"key": k, "label": l} for k, l in importer.BIG_GROUPS],
            "categories": [{"name": n, "group": g} for n, g in importer.CATEGORIES.items()],
            "tags": [{"key": k, "label": l} for k, l, _ in importer.TAGS]}


@app.get("/api/admin/stats")
async def admin_stats(request: Request):
    if (deny := guard(request)):
        return deny
    products = importer.load_products()
    groups = defaultdict(int)
    for p in products:
        groups[p.get("cat_name") or "Без категорії"] += 1
    orders_file = DATA_DIR / "orders.jsonl"
    orders = sum(1 for _ in orders_file.open(encoding="utf-8")) if orders_file.exists() else 0
    return {"ok": True, "total": len(products), "telegram": bool(TOKEN and CHAT_ID), "orders": orders,
            "no_photo": sum(1 for p in products if not p.get("img")),
            "groups": [{"key": k, "label": k, "count": groups[k]} for k in groups]}


@app.get("/api/admin/products")
async def admin_products(request: Request, q: str = "", nophoto: int = 0, group: str = ""):
    if (deny := guard(request)):
        return deny
    needle = q.strip().lower()
    out = []
    for p in importer.load_products():
        if nophoto and p.get("img"):
            continue
        if group and p.get("cat_name") != group:
            continue
        hay = f"{p['name']} {p['sub']} {p['brand']} {p['id']}".lower()
        if needle and needle not in hay:
            continue
        out.append({"id": p["id"], "name": p["name"].replace("\n", " "), "sub": p["sub"],
                    "price": p["price"], "img": p.get("img"), "g": p.get("g"),
                    "cat": p.get("cat"), "weighted": p.get("weighted", False),
                    "note": p.get("note")})
    return {"ok": True, "count": len(out), "items": out[:400]}


@app.post("/api/admin/import")
async def admin_import(request: Request, file: UploadFile = File(...),
                       category: str = Form(""), dry_run: str = Form("0")):
    if (deny := guard(request)):
        return deny
    if not file.filename.lower().endswith((".xlsx", ".xlsm")):
        return JSONResponse({"ok": False, "error": "Потрібен файл .xlsx"}, 400)
    if category.strip() not in importer.CATEGORIES:
        return JSONResponse({"ok": False, "error": "Оберіть категорію зі списку. "
                                                  "Якщо списку немає — оновіть сторінку адмінки (Cmd+Shift+R)."}, 400)

    tmp = Path(tempfile.mkdtemp()) / file.filename
    tmp.write_bytes(await file.read())
    try:
        result = await asyncio.to_thread(importer.import_table, str(tmp), category.strip(),
                                         0, dry_run == "1", True, lambda *_: None)
    except Exception as e:
        log.exception("Імпорт не вдався")
        return JSONResponse({"ok": False, "error": f"Не вдалося прочитати таблицю: {e}"}, 400)
    finally:
        shutil.rmtree(tmp.parent, ignore_errors=True)

    log.info("Імпорт %s: +%s, оновлено %s", file.filename, result["added"], result["updated"])
    return {"ok": True, **result}


@app.post("/api/admin/photo/{code}")
async def admin_photo(code: str, request: Request, file: UploadFile = File(...)):
    if (deny := guard(request)):
        return deny
    if not re.fullmatch(r"[0-9A-Za-z_-]{1,20}", code):
        return JSONResponse({"ok": False, "error": "Некоректний код"}, 400)
    data = await file.read()
    if len(data) > 12 * 1024 * 1024:
        return JSONResponse({"ok": False, "error": "Файл більший за 12 МБ"}, 400)

    products = importer.load_products()
    item = next((p for p in products if p["id"] == code), None)
    if not item:
        return JSONResponse({"ok": False, "error": "Товар не знайдено"}, 404)
    name, ver = await asyncio.to_thread(importer.save_named_image, data, item)
    if not name:
        return JSONResponse({"ok": False, "error": "Не вдалося прочитати зображення"}, 400)
    item["img"], item["img_v"], item["full"] = name, ver, True
    importer.save_products(products)
    log.info("Фото %s → %s.webp", code, name)
    return {"ok": True, "img": name, "img_v": ver, "file": f"{name}.webp"}


@app.post("/api/admin/photos")
async def admin_photos_bulk(request: Request, files: list[UploadFile] = File(...)):
    """Кілька фото одразу: назва файлу = код товару (3825.jpg, 3825-2.png)."""
    if (deny := guard(request)):
        return deny
    products = importer.load_products()
    by_id = {p["id"]: p for p in products}
    done, skipped = [], []
    for f in files[:100]:
        m = re.match(r"\s*(\d+)", Path(f.filename or "").stem)
        code = m.group(1) if m else None
        if not code or code not in by_id:
            skipped.append({"file": f.filename, "reason": "немає товару з таким кодом"})
            continue
        data = await f.read()
        if len(data) > 12 * 1024 * 1024:
            skipped.append({"file": f.filename, "reason": "файл більший за 12 МБ"})
            continue
        name, ver = await asyncio.to_thread(importer.save_named_image, data, by_id[code])
        if not name:
            skipped.append({"file": f.filename, "reason": "не вдалося прочитати зображення"})
            continue
        by_id[code]["img"], by_id[code]["img_v"], by_id[code]["full"] = name, ver, True
        done.append({"file": f.filename, "id": code, "name": by_id[code]["name"].replace("\n", " ")})
    importer.save_products(products)
    log.info("Масове фото: %s поставлено, %s пропущено", len(done), len(skipped))
    return {"ok": True, "done": done, "skipped": skipped}


TAG_KEYS = {k for k, _l, _w in importer.TAGS}


def apply_fields(p: dict, body: dict):
    """Переносить дозволені поля з форми в товар. Повертає текст помилки або None."""
    if "price" in body:
        try:
            p["price"] = max(0, int(float(str(body["price"]).replace(",", "."))))
        except (TypeError, ValueError):
            return "Ціна має бути числом"
    for field, limit in (("name", 160), ("sub", 200), ("brand", 60), ("tag", 120),
                         ("desc", 2000), ("sostav", 2000), ("size_chart", 300)):
        if field in body:
            val = str(body[field] or "").replace("\r", "").strip()[:limit]
            if field == "name":
                val = re.sub(r"\n{2,}", "\n", val)
            if field == "brand":
                val = val.upper()
            p[field] = val or (None if field in ("sostav", "size_chart") else "")
    if "ean" in body:
        digits = re.sub(r"\D", "", str(body["ean"] or ""))
        if digits and len(digits) not in (8, 12, 13):
            return "Штрихкод має містити 8, 12 або 13 цифр"
        p["ean"] = ("0" + digits if len(digits) == 12 else digits) or None
    if "comp" in body:
        lines = body["comp"] if isinstance(body["comp"], list) else str(body["comp"]).split("\n")
        p["comp"] = [clean(x, 120) for x in lines if clean(x, 120)][:8]
    if "weighted" in body:
        p["weighted"] = bool(body["weighted"])
    if "tags" in body:
        p["tags"] = [t for t in (body["tags"] or []) if t in TAG_KEYS]
        p["vegan"] = "vegan" in p["tags"]
    for field in ("sizes", "colors"):
        if field in body:
            vals = body[field] if isinstance(body[field], list) else importer.split_list(body[field])
            p[field] = [clean(v, 40) for v in vals if clean(v, 40)][:20]
    if "cat_name" in body:
        if body["cat_name"] not in importer.CATEGORIES:
            return "Оберіть категорію зі списку"
        p["cat_name"] = body["cat_name"]
        p["cat"] = p["sect"] = body["cat_name"].upper()
        p["g"] = importer.group_of_category(body["cat_name"])
    p["needs_choice"] = bool(p.get("sizes") or p.get("colors")) or \
        p.get("cat_name") in importer.VARIANT_CATEGORIES
    return None


@app.post("/api/admin/product/{code}")
async def admin_edit(code: str, request: Request):
    if (deny := guard(request)):
        return deny
    body = await request.json()
    products = importer.load_products()
    item = next((p for p in products if p["id"] == code), None)
    if not item:
        return JSONResponse({"ok": False, "error": "Товар не знайдено"}, 404)
    err = apply_fields(item, body)
    if err:
        return JSONResponse({"ok": False, "error": err}, 400)
    importer.save_products(products)
    log.info("Картку %s змінено", code)
    return {"ok": True, "product": item}


@app.post("/api/admin/product")
async def admin_create(request: Request):
    if (deny := guard(request)):
        return deny
    body = await request.json()
    code = re.sub(r"\D", "", str(body.get("id") or ""))
    if not code:
        return JSONResponse({"ok": False, "error": "Вкажіть внутрішній код товару (цифри)"}, 400)
    products = importer.load_products()
    if any(p["id"] == code for p in products):
        return JSONResponse({"ok": False, "error": f"Товар із кодом {code} уже є"}, 400)
    if not str(body.get("name") or "").strip():
        return JSONResponse({"ok": False, "error": "Вкажіть назву"}, 400)
    item = {"id": code, "img": None, "full": False, "brand": "БЕЗ ТМ", "cat": "", "cat_name": "",
            "g": "food", "price": 0, "pop": len(products), "tag": "", "name": "", "sub": "",
            "desc": "", "sostav": None, "comp": [], "ean": None, "weighted": False, "note": None,
            "sect": "", "tags": [], "vegan": False, "sizes": [], "colors": [], "size_chart": None,
            "needs_choice": False}
    body.setdefault("cat_name", "Молочні продукти та сири")
    err = apply_fields(item, body)
    if err:
        return JSONResponse({"ok": False, "error": err}, 400)
    products.append(item)
    importer.save_products(products)
    log.info("Створено картку %s", code)
    return {"ok": True, "product": item}


@app.delete("/api/admin/product/{code}")
async def admin_delete(code: str, request: Request):
    if (deny := guard(request)):
        return deny
    products = importer.load_products()
    rest = [p for p in products if p["id"] != code]
    if len(rest) == len(products):
        return JSONResponse({"ok": False, "error": "Товар не знайдено"}, 404)
    importer.save_products(rest)
    return {"ok": True, "total": len(rest)}


@app.get("/api/admin/orders")
async def admin_orders(request: Request, n: int = 30):
    if (deny := guard(request)):
        return deny
    path = DATA_DIR / "orders.jsonl"
    if not path.exists():
        return {"ok": True, "items": []}
    rows = path.read_text(encoding="utf-8").strip().splitlines()[-max(1, min(n, 200)):]
    items = []
    for line in reversed(rows):
        try:
            items.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return {"ok": True, "items": items}


if SERVE_STATIC:                                     # зручно для локального запуску
    app.mount("/", StaticFiles(directory=str(ROOT), html=True), name="site")
