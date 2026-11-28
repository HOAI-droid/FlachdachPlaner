#!/usr/bin/env bash
# Ein Befehl für alle automatischen Prüfungen. Führt aus, was im Projekt vorhanden ist.
# Aufruf: bash scripts/check.sh   (Exit-Code 0 = alles grün)
set -u
fail=0
run() { echo "▶ $*"; "$@" || { echo "✖ FEHLER: $*"; fail=1; }; }

if [ -f package.json ]; then
  [ -d node_modules ] || run npm install
  for s in lint typecheck test build; do
    if node -e "process.exit(require('./package.json').scripts?.['$s']?0:1)"; then
      run npm run "$s" --silent
    fi
  done
elif [ -f pyproject.toml ] || [ -f requirements.txt ]; then
  command -v ruff >/dev/null && run ruff check .
  command -v pytest >/dev/null && run pytest -q
fi

# Optional: Design-Detektor (Impeccable, 62 feste Regeln, kein LLM, keine Tokens).
# Nur bei Web-Projekten. Funde sind standardmäßig eine WARNUNG; mit DESIGN_STRICT=1 zählen sie als Fehler.
# Abschalten mit DESIGN_CHECK=0.
if [ "${DESIGN_CHECK:-1}" = "1" ]; then
  target=""
  for d in src app pages public; do [ -d "$d" ] && target="$target $d"; done
  ls ./*.html >/dev/null 2>&1 && target="$target ."
  if [ -n "$target" ] && command -v npx >/dev/null; then
    echo "▶ impeccable detect$target"
    out=$(npx --yes impeccable detect $target 2>&1); code=$?
    if [ "$code" -eq 2 ]; then
      echo "$out" | grep -v '^npm notice' | head -40
      echo "⚠ Design-Funde (siehe oben)"
      [ "${DESIGN_STRICT:-0}" = "1" ] && fail=1
    elif [ "$code" -ne 0 ]; then
      echo "⚠ Detektor nicht ausführbar (Exit $code), übersprungen"
    else
      echo "✔ Design-Detektor: keine Funde"
    fi
  fi
fi

if [ "$fail" -eq 0 ]; then echo "✔ ALLES GRÜN"; else echo "✖ NICHT GRÜN"; fi
exit "$fail"
