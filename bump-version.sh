#!/usr/bin/env bash
# Setzt die App-Version an allen vier Stellen: index.html (?v= an styles.css und
# app.js), app.js (APP_VERSION) und sw.js (CACHE + ASSETS). Vor jedem Deploy
# aufrufen, sonst holen Browser wegen max-age=600 alte Dateien.
#   ./bump-version.sh 8
set -euo pipefail
cd "$(dirname "$0")"

new="${1:-}"
[ -n "$new" ] || { echo "Aufruf: ./bump-version.sh <version>" >&2; exit 1; }
[[ "$new" =~ ^[0-9]+$ ]] || { echo "Version muss eine Zahl sein" >&2; exit 1; }

sed -i -E "s/(styles\.css\?v=)[0-9]+/\1$new/; s/(app\.js\?v=)[0-9]+/\1$new/" index.html
sed -i -E "s/(const APP_VERSION = ')[0-9]+(')/\1$new\2/" app.js
sed -i -E "s/(stichansagen-v)[0-9]+/\1$new/; s/(styles\.css\?v=)[0-9]+/\1$new/; s/(app\.js\?v=)[0-9]+/\1$new/" sw.js

echo "Version $new gesetzt:"
grep -o "styles\.css?v=[0-9]*\|app\.js?v=[0-9]*" index.html | sed 's/^/  index.html  /'
grep -o "const APP_VERSION = '[0-9]*'" app.js       | sed 's/^/  app.js      /'
grep -o "stichansagen-v[0-9]*" sw.js                 | sed 's/^/  sw.js       /'
