# -*- coding: utf-8 -*-
"""Помічник «Допоможи обрати»: діалог із Claude + пошук у каталозі магазину.

Браузер надсилає історію розмови, сервер веде цикл із Claude:
  • search_catalog     — Claude шукає товари в products.json (виконує наш сервер);
  • offer_choices      — Claude ставить питання з кнопками-варіантами (кінець ходу);
  • present_selection  — Claude віддає підбірку з реальних кодів товарів (кінець ходу).
Ключ API живе лише в .env на сервері.
"""
import json, os, re, time
from collections import defaultdict, deque

import httpx

from server import importer

API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5").strip()
API_URL = "https://api.anthropic.com/v1/messages"

TAG_LABELS = {k: l for k, l, _ in importer.TAGS}

SYSTEM = """Ти — консультант онлайн-магазину здорової їжі «ЇМО ВІРНО». Допомагаєш покупцю швидко
обрати товари і збираєш для нього підбірку.

ГОЛОВНЕ: покупець прийшов по підбірку, а не по анкету.
• Максимум ОДНЕ уточнення за всю розмову. Якщо запит хоч трохи зрозумілий — одразу шукай і показуй підбірку.
  Уточнити деталі можна вже ПІСЛЯ підбірки («Можу підібрати дешевше або без цукру»).
• Якщо покупець змінює тему («насправді я дуже голодна»), забудь попередній запит і працюй з новим.
• Не комбінуй нові обмеження, яких покупець не називав.

Мова:
• Лише правильна українська, на «ви». Жодних русизмів (не «нравиться», а «подобається»; не «кушати», а «їсти»).
• 1–2 коротких речення. Без списків і без прикладів товарів у тексті питання — приклади лише з пошуку.

Товари:
• Бери ЛИШЕ з результатів search_catalog. Не вигадуй назв, цін, властивостей.
• Роби 2–4 пошуки різними словами, щоб підбірка була різноманітною.
• present_selection: 4–8 товарів, до кожного — чому підходить (до 90 символів). Перевага товарам із фото.
• Про дієтичні добавки — без медичних обіцянок; за потреби порадь лікаря.

Що шукати за типовими запитами (орієнтир, не обмеження):
• Солоденького — кондитерські вироби, шоколад, мармелад, батончики, сухофрукти, морозиво.
• Солодке й низькокалорійне — позначка «Без цукру», батончики, сухофрукти, желе, мармелад без цукру.
• Солоне, але легке — хлібці, чипси овочеві, горіхи, насіння, оливки, сири.
• Дуже голодний — ситне: готові страви, м'ясні продукти, сири, хліб, заморожені напівфабрикати. Без уточнень.
• Приготувати вдома — бакалія, крупи, макарони, олії, соуси, спеції, заморожене, м'ясо, риба.
• Перекус на ходу — батончики, горіхи, хлібці, снеки, питні йогурти, сирки.
• Освіжитись — безалкогольні напої, вода, холодний чай, соки, морозиво.
• Дієтичні добавки — категорія «Дієтичні добавки, вітаміни та суперфуди».
• Хелсі-фуд — суперфуди, горіхи, насіння, цільнозернове, без цукру, веганське.
• Веганське — позначка «Веган» і категорія «Веганські та рослинні альтернативи».
• Замінити каву — цикорій, матча, какао, трав'яні напої, «кава» з ячменю чи жолудів.
• Замінити чай — трав'яні збори, фіточаї, ройбуш, каркаде, узвари.

Категорії каталогу: {categories}
Позначки товарів: {tags}
"""

TOOLS = [
    {
        "name": "search_catalog",
        "description": "Пошук товарів у каталозі магазину. Повертає до 25 товарів із кодом, назвою, "
                       "брендом, категорією, ціною, позначками і коротким описом.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Слова для пошуку українською: тип продукту, смак, інгредієнт"},
                "categories": {"type": "array", "items": {"type": "string"},
                               "description": "Обмежити категоріями з переліку (точні назви)"},
                "tags": {"type": "array", "items": {"type": "string", "enum": list(TAG_LABELS)},
                         "description": "Товар має мати всі ці позначки"},
                "max_price": {"type": "number", "description": "Максимальна ціна, грн"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 25},
            },
        },
    },
    {
        "name": "offer_choices",
        "description": "Поставити покупцю питання з кнопками-варіантами відповіді. Завершує твій хід.",
        "input_schema": {
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "Питання, 1–2 речення"},
                "options": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 6,
                            "description": "Короткі варіанти відповіді, до 30 символів"},
            },
            "required": ["question", "options"],
        },
    },
    {
        "name": "present_selection",
        "description": "Показати покупцю готову підбірку. Лише коди з результатів search_catalog. Завершує твій хід.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Назва підбірки, до 40 символів"},
                "intro": {"type": "string", "description": "1–2 речення до покупця про підбірку"},
                "items": {"type": "array", "minItems": 1, "maxItems": 8,
                          "items": {"type": "object",
                                    "properties": {"id": {"type": "string"},
                                                   "why": {"type": "string"}},
                                    "required": ["id", "why"]}},
            },
            "required": ["title", "intro", "items"],
        },
    },
]

_hits = defaultdict(deque)   # захист від зловживань: 40 повідомлень / 15 хв з IP


def too_often(ip: str) -> bool:
    now, q = time.time(), _hits[ip]
    while q and now - q[0] > 900:
        q.popleft()
    if len(q) >= 40:
        return True
    q.append(now)
    return False


def _norm(s: str) -> str:
    return re.sub(r"[^a-zа-яіїєґ0-9 ]", " ", str(s or "").lower().replace("’", "'"))


def search(products, query="", categories=None, tags=None, max_price=None, limit=15):
    words = [w for w in _norm(query).split() if len(w) > 2]
    stems = [w[:max(4, len(w) - 2)] for w in words]      # грубе відсікання закінчень
    cats = set(categories or [])
    need = set(tags or [])
    scored = []
    for p in products:
        if cats and p.get("cat_name") not in cats:
            continue
        if need and not need.issubset(set(p.get("tags") or [])):
            continue
        if max_price and p.get("price", 0) > max_price:
            continue
        name = _norm(p.get("name"))
        rest = _norm(" ".join(str(p.get(k) or "") for k in ("sub", "brand", "cat_name", "desc", "sostav")))
        score = 0
        for s in stems:
            if s in name:
                score += 3
            elif s in rest:
                score += 1
        if stems and score == 0:
            continue
        score += 0.5 if p.get("img") else 0
        scored.append((score, p))
    scored.sort(key=lambda x: (-x[0], x[1].get("pop", 0)))
    out = []
    for _s, p in scored[:max(1, min(int(limit or 15), 25))]:
        out.append({
            "id": p["id"], "name": p["name"].replace("\n", " "), "brand": p.get("brand"),
            "category": p.get("cat_name"), "price": p.get("price"),
            "per_kg": bool(p.get("weighted")), "tags": [TAG_LABELS.get(t, t) for t in p.get("tags") or []],
            "has_photo": bool(p.get("img")), "desc": (p.get("desc") or "")[:160],
        })
    return out


async def call_claude(messages, system, allow_questions=True):
    headers = {"x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"}
    tools = TOOLS if allow_questions else [t for t in TOOLS if t["name"] != "offer_choices"]
    payload = {"model": MODEL, "max_tokens": 1200, "system": system, "tools": tools, "messages": messages}
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(API_URL, headers=headers, json=payload)
    if r.status_code != 200:
        raise RuntimeError(f"Claude API {r.status_code}: {r.text[:200]}")
    return r.json()


def clean_history(history):
    """Лише текстові репліки user/assistant, чергуються, починаються з user, не довші за 20 ходів."""
    out = []
    for m in (history or [])[-20:]:
        role = m.get("role")
        text = str(m.get("text") or "").strip()[:1500]
        if role not in ("user", "assistant") or not text:
            continue
        if out and out[-1]["role"] == role:
            out[-1]["content"] += "\n" + text
        else:
            out.append({"role": role, "content": text})
    while out and out[0]["role"] != "user":
        out.pop(0)
    return out


async def chat(history):
    if not API_KEY:
        return {"reply": "Помічник ще не підключений: на сервері не задано ANTHROPIC_API_KEY.", "error": True}
    products = importer.load_products()
    by_id = {p["id"]: p for p in products}
    system = SYSTEM.format(categories="; ".join(sorted({p.get("cat_name") for p in products if p.get("cat_name")})),
                           tags=", ".join(TAG_LABELS.values()))
    messages = clean_history(history)
    if not messages:
        return {"reply": "Розкажіть, чого вам хочеться, і я підберу варіанти."}

    # скільки разів помічник уже питав після останньої підбірки
    asked = 0
    for m in reversed(history or []):
        if m.get("role") == "assistant":
            if m.get("selection") or "[Показано підбірку" in str(m.get("text", "")):
                break
            if m.get("choices") or "?" in str(m.get("text", "")):
                asked += 1
    allow_q = asked < 1
    if not allow_q:
        system += ("\n\nУТОЧНЕНЬ ДОСИТЬ. Покупець уже відповідав на питання. Зараз виконай search_catalog "
                   "(кілька разів, якщо треба) і обов'язково заверши present_selection. Жодних нових питань.")

    text_parts = []
    for _step in range(7):
        resp = await call_claude(messages, system, allow_q)
        blocks = resp.get("content", [])
        text_parts = [b["text"] for b in blocks if b.get("type") == "text" and b.get("text", "").strip()]
        uses = [b for b in blocks if b.get("type") == "tool_use"]
        if not uses:
            return {"reply": "\n".join(text_parts).strip() or "Підкажіть трохи більше — і я підберу."}

        final = next((u for u in uses if u["name"] in ("offer_choices", "present_selection")), None)
        if final and final["name"] == "offer_choices":
            inp = final["input"]
            said = "\n".join(text_parts).strip()
            question = str(inp.get("question", "")).strip()
            # якщо питання вже прозвучало в тексті — не повторюємо його
            reply = said if (said and "?" in said) else "\n".join(x for x in (said, question) if x)
            return {"reply": reply, "choices": [str(o)[:40] for o in inp.get("options", [])][:6]}
        if final and final["name"] == "present_selection":
            inp = final["input"]
            items = [{"id": str(i.get("id")), "why": str(i.get("why", ""))[:140]}
                     for i in inp.get("items", []) if str(i.get("id")) in by_id][:8]
            if items:
                intro = inp.get("intro", "")
                reply = "\n".join(text_parts + [intro]).strip()
                return {"reply": reply, "selection": {"title": str(inp.get("title", "Підбірка"))[:60],
                                                      "intro": intro, "items": items}}
            # коди не знайдені — просимо Claude спробувати ще раз
        # виконуємо пошуки й повертаємо результати Claude
        messages.append({"role": "assistant", "content": blocks})
        results = []
        for u in uses:
            if u["name"] == "search_catalog":
                a = u.get("input", {})
                found = search(products, a.get("query", ""), a.get("categories"), a.get("tags"),
                               a.get("max_price"), a.get("limit", 15))
                content = json.dumps(found, ensure_ascii=False) if found else "Нічого не знайдено, спробуй інші слова."
            else:
                content = "Жоден із кодів не знайдено в каталозі. Використай коди з результатів search_catalog."
            results.append({"type": "tool_result", "tool_use_id": u["id"], "content": content})
        messages.append({"role": "user", "content": results})
    return {"reply": "\n".join(text_parts).strip() or "Давайте уточнимо: що саме вам хочеться?"}
