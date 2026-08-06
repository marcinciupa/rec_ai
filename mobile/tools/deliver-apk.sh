#!/usr/bin/env bash
# Dostarcza zbudowany APK na udział sieciowy z POPRAWNĄ, UNIKALNĄ nazwą i sprząta stare buildy.
# Bliźniak skryptu z gallery_ai — ten sam udział (\\5600G\@5600g), inny prefiks nazwy (rec_ai-).
#
#   ./tools/deliver-apk.sh           → build testowy: rec_ai-<wersja>-t<N>.apk (N samo rośnie)
#   ./tools/deliver-apk.sh --release → build wydaniowy: rec_ai-<wersja>.apk
#   APK_KEEP=5 ./tools/deliver-apk.sh → zostaw 5 ostatnich buildów testowych (domyślnie 3)
#
# Cel = udział SMB. Nie montujemy go (to wymagałoby sudo) — kopiujemy przez PowerShell, któremu
# ścieżkę źródłową podajemy w formie widocznej z Windows (`wslpath -w`). Gdy udział jest nieosiągalny,
# spadamy na Downloads, żeby build nie przepadł. Weryfikuje ŚWIEŻOŚĆ APK (gradle bywa no-op).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
SHARE='\\5600G\@5600g'
FALLBACK_DIR="/mnt/c/Users/glue0/Downloads"
KEEP="${APK_KEEP:-3}"
PREFIX="rec_ai"

[ -f "$APK" ] || { echo "BŁĄD: brak APK — czy build się wykonał? ($APK)" >&2; exit 1; }

VERSION="$(node -p "require('$ROOT/app.json').expo.version")"

# WALIDATOR KONWENCJI WERSJI — żeby dryf nie wyszedł na udział (patrz reguła bump-version-per-feature).
# versionCode = round(version×10000), kończy się na 0 (funkcja) lub 5 (POŁÓWKA = mniej znacząca zmiana);
# versionName = versionCode/10000 z obciętym zerem końcowym (3 cyfry normalnie, 4 z „5" dla połówki).
VCODE="$(node -p "require('$ROOT/app.json').expo.android.versionCode")"
EXP_NAME="$(node -p "(require('$ROOT/app.json').expo.android.versionCode/10000).toString()")"
[ "$VERSION" = "$EXP_NAME" ] || { echo "BŁĄD KONWENCJI: version '$VERSION' ≠ versionCode/10000 ('$EXP_NAME'). Ustaw version='$EXP_NAME' albo popraw versionCode." >&2; exit 1; }
[ $(( VCODE % 5 )) -eq 0 ] || { echo "BŁĄD KONWENCJI: versionCode $VCODE nie kończy się na 0 (funkcja) ani 5 (połówka). Wyrównaj do najbliższego kroku." >&2; exit 1; }

AGE=$(( $(date +%s) - $(stat -c %Y "$APK") ))
if [ "$AGE" -gt 600 ]; then
  echo "⚠️  UWAGA: APK ma $((AGE / 60)) min. Gradle mógł nie przepakować."
fi

ps() { powershell.exe -NoProfile -Command "$1" 2>/dev/null | tr -d '\r'; }

USE_SHARE=0
[ "$(ps "Test-Path '$SHARE'")" = "True" ] && USE_SHARE=1
[ "$USE_SHARE" = 1 ] || echo "⚠️  Udział $SHARE nieosiągalny — zapisuję do $FALLBACK_DIR"

if [ "$USE_SHARE" = 1 ]; then
  LISTING="$(ps "Get-ChildItem -LiteralPath '$SHARE' -Filter '${PREFIX}-*.apk' | Select-Object -ExpandProperty Name")"
else
  LISTING="$(ls "$FALLBACK_DIR" 2>/dev/null | grep "^${PREFIX}-.*\.apk$" || true)"
fi

# Konwencja nazwy (ustalenie użytkownika 2026-07-24): sufiks `-t<N>` TYLKO gdy iteracja testowa tej samej
# wersji (bez nowego ficzera). Pierwszy build ŚWIEŻO bumpniętej wersji (= z ficzerem) → nazwa wydaniowa
# bez sufiksu. Wykrywane automatycznie po braku pliku wydaniowego tej wersji. `--release`/`--test` wymuszają.
RELEASE_NAME="${PREFIX}-${VERSION}.apk"
RELEASE_EXISTS=0
echo "$LISTING" | grep -qx "$RELEASE_NAME" && RELEASE_EXISTS=1

if [ "${1:-}" = "--release" ]; then
  [ "$RELEASE_EXISTS" = 1 ] && { echo "BŁĄD: $RELEASE_NAME już istnieje — bumpnij wersję zamiast nadpisywać." >&2; exit 1; }
  NAME="$RELEASE_NAME"
elif [ "${1:-}" != "--test" ] && [ "$RELEASE_EXISTS" = 0 ]; then
  NAME="$RELEASE_NAME"
else
  # iteracja testowa TEJ SAMEJ wersji. Licznik `-t<N>` RESETUJE SIĘ przy bumpie — każda wersja od t1.
  # Plik `.apk-counter` trzyma "VERSION N"; zmiana wersji → start od 0. Dodatkowo max -t z udziału DLA TEJ
  # wersji (przetrwa utratę licznika; stare buildy bywają skasowane → max(plik, listing)).
  COUNTER="$ROOT/tools/.apk-counter"
  read -r STORED_V STORED_N < "$COUNTER" 2>/dev/null || true
  STORED_V="${STORED_V:-}"; STORED_N="${STORED_N:-0}"
  [ "$STORED_V" = "$VERSION" ] || STORED_N=0
  SEEN=$(echo "$LISTING" | sed -n "s/^${PREFIX}-${VERSION}-t\([0-9]\+\)\.apk$/\1/p" | sort -n | tail -1)
  BASE=$(( STORED_N > ${SEEN:-0} ? STORED_N : ${SEEN:-0} ))
  N=$(( BASE + 1 ))
  echo "$VERSION $N" > "$COUNTER"
  NAME="${PREFIX}-${VERSION}-t${N}.apk"
fi

SRC_WIN="$(wslpath -w "$APK")"
if [ "$USE_SHARE" = 1 ]; then
  ps "Copy-Item -LiteralPath '$SRC_WIN' -Destination '$SHARE\\$NAME' -Force" >/dev/null
  WHERE="$SHARE"
else
  cp "$APK" "$FALLBACK_DIR/$NAME"
  WHERE="$FALLBACK_DIR"
fi
echo "✅ $NAME → $WHERE  ($(du -h "$APK" | cut -f1), zbudowany $(date -d "@$(stat -c %Y "$APK")" '+%H:%M'))"

OLD=$(echo "$LISTING" | sed -n "s/^\(${PREFIX}-.*-t\([0-9]\+\)\.apk\)$/\2 \1/p" | sort -rn | tail -n +"$KEEP" | cut -d' ' -f2)
for f in $OLD; do
  [ "$f" = "$NAME" ] && continue
  if [ "$USE_SHARE" = 1 ]; then ps "Remove-Item -LiteralPath '$SHARE\\$f' -Force" >/dev/null; else rm -f "$FALLBACK_DIR/$f"; fi
  echo "   🗑  usunięto $f"
done
