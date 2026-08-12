# Ikony klawiszy do dorobienia — rec_ai

Infrastruktura ikon (KeyIcon + toggle Settings „KEY ICONS") jest już wpięta i działa dla labelek
wspólnych z gallery_ai. Poniżej klawisze SPECYFICZNE dla dyktafonu, które NIE mają jeszcze ikony —
trzeba je narysować w Figmie (zestaw 32×32, stroke 4, round cap — jak set 496:24601 gallery) i dodać
do `src/components/icons/keyIcons.gen.ts` + mapę `LABEL_ICON` w `KeyButton.tsx`.

## Już pokryte (są w `keyIcons.gen.ts`, działają)
BACK, CLOSE, CANCEL, ABORT, MENU, CONFIRM, ACCEPT, YES, NEXT, PLAY, INFO, SHARE, UNDO, DELETE,
KEYBOARD, SAVE, RESET, SETTINGS, STOP, PAUSE, MUTE, UNMUTE, DETAILS, TASKS, SUMMARY, KEY POINTS,
TRANSCRIBE, RECORDINGS, ASK AI, SPEED (1×/1.5×/2×/3×/5×/10×).

## Do dorobienia — nowy model nawigacji joystickiem (2026-08-06)
Priorytet 1 — bez nich nie wytłumaczymy użytkownikowi gramatyki gałki (hint w WELCOME, ekran INFO):
- `stick` — gałka joysticka: studnia + grzybek + 4 strzałki
- `stick_v` — ↑↓ w gałce („wybór pozycji")
- `stick_h` — ←→ w gałce („zmiana wartości")
- `stick_press` — wciśnięcie środka („zatwierdź"): grzybek + strzałka w dół

Priorytet 2 — domknięcie transportu:
- `rec` — wypełnione kółko. **Potrzebne od razu**: klawisz `REC` na liście nagrań (slot po zdjętym
  `MENU [CYCLE]`) jest na razie tekstowy, bo mapa `LABEL_ICON` nie ma czym go pokryć.
- `shuttle` — pas z grotem („przewijanie analogowe") — podpis przy sliderze w odtwarzaczu
- `fling` — szybkie przewijanie listy (knob slidera na liście nagrań)

Bez przypisania (ikony zostają w zestawie, ale klawisze zniknęły): `menu`, `skip` (było NEXT [CYCLE]).

Uwaga: labelki metalowego rzędu (PLAY/PAUSE/NEXT jako `MetalLabelKey` — dwuliniowe) na razie
POZOSTAJĄ tekstem — tryb ikon obejmuje górny rząd `ScreenKey`. Gdy powstanie zestaw, można dorobić
wariant ikonowy również dla `MetalLabelKey`.
