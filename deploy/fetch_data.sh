#!/usr/bin/env sh
# Забрати каталог і фото з сервера собі (сервер — джерело правди після адмінки).
#   SERVER=root@2.28.7.227 ./deploy/fetch_data.sh
set -eu
: "${SERVER:?Вкажіть SERVER=root@IP}"
TARGET="${TARGET:-/var/www/imo-virno}"

rsync -az "$SERVER:$TARGET/assets/data/" assets/data/
rsync -az "$SERVER:$TARGET/assets/img/"  assets/img/

python3 - <<'PY'
import json
d = json.load(open("assets/data/products.json", encoding="utf-8"))
cats = {}
for p in d:
    cats[p.get("cat_name") or "?"] = cats.get(p.get("cat_name") or "?", 0) + 1
print(f"Забрано з сервера: {len(d)} товарів, без фото {sum(1 for p in d if not p.get('img'))}")
for name, n in sorted(cats.items(), key=lambda x: -x[1]):
    print(f"  {n:>4}  {name}")
PY
echo "Тепер можна закомітити зміни в git."
