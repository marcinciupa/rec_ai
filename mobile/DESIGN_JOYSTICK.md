# Joystick + haptyka — rec_ai

Przeniesione z bliźniaczego projektu `gallery_ai`. Ten dokument opisuje **środkową kontrolkę klawiatury**
(`src/components/chrome/Joystick.tsx`) i jej **haptykę** (`src/lib/haptics.ts`).

## Fizyka / wygląd (Figma 375:4962)
Metalowy kwadrat 76 (wypukły bevel, jak zwykły klawisz) → wklęsła ciemna studnia 66 (recessed bevel + inset
shadow) → wypukły grzybek 24 przesuwający się za palcem i sprężynujący na środek (`Animated.spring`).

**Kolor grzybka niesie znaczenie i nie wolno go rozmyć** (decyzja 2026-08-06):
- `tone: 'rec'` — grzybek **czerwony z poświatą** (dioda REC) **wyłącznie tam, gdzie wciśnięcie faktycznie
  nagrywa**: ekran RECORDING (start/pauza/wznów) i pytanie głosowe w czacie. `recActive` (trwa nagrywanie)
  → mocna poświata (`recordGlowStrong`), gotowość → słaba (`recordGlow`).
- domyślnie `tone: 'metal'` — grzybek metalowy jak w `gallery_ai`; `highlighted` = jaśniejszy stop
  (`bevelButton` zamiast `bevelSharp`) i znaczy „nawigacja aktywna", nic więcej.

## Model nawigacji (jedna czynność = jedna kontrolka)
Joystick jest **jedyną kontrolką kursora** w apce. Gramatyka jest identyczna na każdym ekranie:

| | joystick |
|---|---|
| ↑↓ | pozycja — element listy (przytrzymanie: `repeat: 'vertical'`) |
| ←→ | wartość / ruch wewnątrz zaznaczonego elementu |
| środek | ZATWIERDŹ akcję zaznaczonego elementu (na ekranach `tone: 'rec'` — nagrywanie) |

Podział ról między kontrolkami obudowy:
- **joystick** — nawigacja krokowa (jedyna),
- **slider/shuttle** — tylko ruch ANALOGOWY: scrub taśmy w odtwarzaczu, fling listy nagrań; przyciski ⏪⏩
  = skok po segmentach transkryptu. Nigdy „poprzedni/następny element" — to jest krok, czyli joystick,
- **klawisze „screen"** — nazwane akcje. Duplikat akcji joysticka jest dozwolony **tylko gdy klawisz ją
  nazywa** (CHANGE, akcja wiersza na liście). Bezimienne kopie (`NEXT [CYCLE]`, `MENU [CYCLE]`) zostały
  usunięte — to była trzecia kontrolka do tej samej czynności,
- **klawisze metalowe** — stały transport: STOP/BACK i PLAY/PAUSE (labele niezmienne, zmienia się podświetlenie).

Mapowanie per ekran:
- **RECORDING** — kierunki bezczynne, grzybek czerwony; środek = START / PAUSE / RESUME.
- **PLAYBACK / LIST** — ↑↓ wybór nagrania (repeat), ←→ cykl opcji wiersza, środek = wykonaj podświetloną
  opcję. Slider: knob = fling listy. Wyjście do nagrywania: nazwany klawisz `REC`.
- **PLAYBACK / PLAYER** — ↑↓ poprzednie/następne nagranie, ←→ seek ±5 s, środek = play/pause.
  Slider: knob = shuttle, ⏪⏩ = segmenty transkryptu (gdy jest transkrypt; inaczej przygaszone).
- **CHAT** — ↑↓ para pytanie→odpowiedź, środek = zadaj pytanie głosem (grzybek czerwony, mocny glow gdy słucha).
- **SETTINGS / WELCOME** — ↑↓ wiersz (repeat), ←→ / środek zmiana wartości. Slider wygaszony.

Gałka jest „samolubna" na gest: `onPanResponderTerminationRequest → false`, żeby poziome ruchy nie były
oddawane ekranowemu swipe. Kierunek można **zmienić w locie** bez odrywania palca (port z gallery_ai).

## Haptyka
Rodzina impulsów w `lib/haptics.ts` (PWM na `Vibration` — Android nie daje kontroli amplitudy, więc
rozróżniamy **długością i liczbą** impulsów, nie siłą):
- `hapticPress()` / `hapticRelease()` — chwyt aktywnej gałki / wciśnięcie środka.
- `hapticShort()` — chwyt gałki bez akcji (pusty ekran).
- `hapticKnob(intensity, ms = 28)` — krótki impuls o sile proporcjonalnej do wychylenia. Parametr `ms`
  pozwala na krótszy „klik" zapadki (12) vs impuls złapania kierunku (28).
- `hapticKnobReturn(active)` — powrót do 0: nieaktywny → pojedynczy tick `[45]`, aktywny → podwójny
  „tik-tik" `[28,50,28]` (odróżnialny od klawiatury).

### Opór progresywny (detents)
Sedno „czucia" joysticka. Droga gałki (`0..nubTravel`) dzielona jest na `DETENTS = 6` zapadek. W
`onPanResponderMove`:
- **przekroczenie zapadki w stronę wychylenia** → `hapticKnob(0.12 + 0.62 * det/DETENTS, 12)` — impuls
  rośnie z wychyleniem (imitacja rosnącego oporu sprężyny).
- **powrót do neutrum jeszcze w trakcie gestu** (`det === 0`, a był `> 0`) → delikatny `hapticKnob(0.1, 10)`.
- przy powrocie do środka opór **nie rośnie** (nie strzelamy zapadkami w dół — opór maleje).

Kwantyzacja na zapadki jest konieczna: bez niej trzeba by strzelać haptyką na każde zdarzenie ruchu
(~60/s) = ciągłe brzęczenie. Po złapaniu kierunku ustawiamy `lastDetent = DETENTS`, żeby nie dublować
zapadki z impulsem złapania. `lastDetent` zerujemy w grant/release/terminate.

### Powrót do pozycji 0
Puszczenie gałki: `springBack()` (wizualnie) + `hapticKnobReturn(highlighted)` (haptycznie). Tap środka
(brak wychylenia) idzie osobną ścieżką z `hapticRelease()`.

### Auto-repeat
`repeat: true | 'vertical'` — przytrzymanie wychylenia powtarza kierunek co 120 ms (haptyka co drugi tick,
~240 ms, inaczej czyta się jak ciągłe brzęczenie). W rec_ai włączony **tylko na osi pionowej** (długie
listy: nagrania, ustawienia). Poziom celowo bez repeatu — seek ±5 s ma zostać krokiem, bo płynne
przewijanie należy do shuttle'a.

## Różnice vs gallery_ai (świadome)
gallery_ai ma dodatkowo: ciągłe wychylenie (`onDirStart/onDirEnd` — płynny przewijany feed) i
hold-to-select środka. rec_ai ich nie ma: płynne przewijanie robi u nas **slider** (jedyna kontrolka
analogowa), a przytrzymanie środka zostaje wolne. Wzorzec, gdyby był potrzebny:
`gallery_ai/src/components/chrome/Joystick.tsx` (`onDirStart` / `holdCompleteT`).
