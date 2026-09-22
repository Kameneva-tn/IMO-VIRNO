#!/usr/bin/env bash
# Одноразове налаштування на сервері Ubuntu. Запускати від root:
#   bash /var/www/imo-virno/deploy/setup_server.sh
set -eu

SITE=/var/www/imo-virno

apt-get update -qq
apt-get install -y -qq nginx python3-venv python3-pip rsync

# віртуальне середовище для обробника замовлень
python3 -m venv "$SITE/.venv"
"$SITE/.venv/bin/pip" install -q --upgrade pip
"$SITE/.venv/bin/pip" install -q -r "$SITE/server/requirements.txt"

# сховище замовлень
mkdir -p /var/lib/imo-virno
chown -R www-data:www-data /var/lib/imo-virno "$SITE"

# .env з токенами
if [ ! -f "$SITE/.env" ]; then
  cp "$SITE/.env.example" "$SITE/.env"
  echo "→ Впишіть TELEGRAM_BOT_TOKEN і ADMIN_CHAT_ID у $SITE/.env, потім: systemctl restart imo-virno-api"
fi
chmod 600 "$SITE/.env"

# сервіс
cp "$SITE/deploy/imo-virno-api.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now imo-virno-api

# nginx
cp "$SITE/deploy/nginx.conf" /etc/nginx/sites-available/imo-virno
ln -sf /etc/nginx/sites-available/imo-virno /etc/nginx/sites-enabled/imo-virno
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo
echo "Готово. Перевірка: curl -s localhost/api/health"
echo "Логи замовлень: journalctl -u imo-virno-api -f"
