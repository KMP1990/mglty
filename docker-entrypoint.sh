#!/bin/sh
# Render/Fly يركّبان قرصًا دائمًا على /app/data بصلاحيات root.
# نضبط ملكية مجلد البيانات ثم ننزل لمستخدم التطبيق غير الجذري.
set -e

if [ "$(id -u)" = "0" ]; then
  DATA="${DATA_DIR:-/app/data}"
  mkdir -p "$DATA"
  chown -R app:app "$DATA" 2>/dev/null || true
  exec su-exec app "$@"
fi

exec "$@"
