#!/usr/bin/env sh
# Оновлення сайту на сервері.
#   SERVER=root@2.28.7.227 ./deploy/deploy.sh
#
# Код і оформлення оновлюються повністю.
# Каталог (assets/data/products.json) і фото, додані через адмінку,
# на сервері НЕ затираються: там вони новіші за копію на вашому Mac.
# Щоб забрати серверні дані собі — ./deploy/fetch_data.sh
set -eu
: "${SERVER:?Вкажіть SERVER=root@IP}"
TARGET="${TARGET:-/var/www/imo-virno}"

ssh "$SERVER" "mkdir -p $TARGET/assets/data $TARGET/assets/img"

echo "→ код і оформлення"
rsync -az --delete \
  --exclude ".git" --exclude ".env" --exclude ".venv" --exclude "__pycache__" \
  --exclude "assets/data/" --exclude "assets/img/" \
  ./ "$SERVER:$TARGET/"

echo "→ фото (наявні на сервері не чіпаємо)"
rsync -az --ignore-existing assets/img/ "$SERVER:$TARGET/assets/img/"

echo "→ каталог"
if ssh "$SERVER" "test -s $TARGET/assets/data/products.json"; then
  echo "   на сервері вже є каталог — лишаємо його, він новіший"
else
  rsync -az assets/data/ "$SERVER:$TARGET/assets/data/"
  echo "   каталог скопійовано вперше"
fi

ssh "$SERVER" "systemctl restart imo-virno-api 2>/dev/null; systemctl reload nginx 2>/dev/null; sleep 2; curl -s localhost/api/health; echo"
echo "Готово: $SERVER:$TARGET"
