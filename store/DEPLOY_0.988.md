# Wdrożenie 0.988 (versionCode 9880) na Google Play

> Build z `main` @ `0163497` (fast-forward z https://github.com/marcinciupa/rec_ai.git, 2026-08-17).
> Poprzednia wersja na sklepie: **0.974 (9740)**.
> Artefakt: `mobile/android/app/build/outputs/bundle/release/app-release.aab` (60,3 MB, 2026-08-17 10:03).

---

## 1. Wersjonowanie — sprawdzone

| Pole | Wartość | Status |
|---|---|---|
| `expo.version` (versionName) | `0.988` | ✅ |
| `expo.android.versionCode` | `9880` | ✅ > 9740 |
| `src/version.ts` → `APP_VERSION` | `0.988` | ✅ zgodne z app.json |
| Konwencja `versionCode = round(version × 10000)` | 0.988 × 10000 = 9880 | ✅ |
| Konwencja „końcówka 0 (funkcja) / 5 (połówka)" | 9880 → `0` = zmiana funkcjonalna | ✅ |
| `applicationId` | `com.glue010.recai` | ✅ bez zmian |

Wersji **nie podbijałem** — `main` przyszedł już na 0.988 (commit `0d7b525`), numer jest wolny i rosnący.

⚠️ Przy uploadzie potwierdź w Play Console, że **9880 nie było użyte na żadnym torze**
(internal/closed testing też blokuje numer).

---

## 2. Co wchodzi w tej aktualizacji (0.975 → 0.988)

Sześć commitów ponad wersją sklepową 9740:

| Commit | Wersja | Zmiana |
|---|---|---|
| `c9fc75c` | 0.975 | Realne wolne miejsce (liczone z bitrate'u wg ustawienia QUALITY) zamiast zaszytego na sztywno napisu; stopka z wersją w Ustawieniach |
| `0a9fbda` | 0.976 | Skróty imion rozmówców (Marc→MRC) rozpoznawane z treści rozmowy zamiast numerów; migracja bazy v4 (`speaker_names`) |
| `21e84b3` | — | Adaptacyjne skalowanie waveformu (percentylowy floor/ceiling z okna ~4 s) zamiast sztywnej formuły dB, która nasycała się przy −20 dBFS |
| `5db15e0` | 0.978 | AI SPEAKERS / AI PARAGRAPHS — rozmówcy i akapity wyprowadzane z treści, gdy deAPI ich nie daje; **fix:** AUTO TRANSCRIBE ignorowało ustawienia AI ENGINE i AI LANGUAGE |
| `0d7b525` | 0.988 | Podział rozmówców po słowach (+16 % trafności na realnym nagraniu), auto-scroll transkryptu z realnej geometrii wierszy, toasty zdarzeń transkrypcji, joystick na liście nagrań (biegi + haptyka), nowy zestaw ikon klawiszy, pierścień postępu holdu |
| `0163497` | — | Merge PR #4 |

Uprawnienia i kategorie danych: **bez zmian** względem 9740 (ten sam strumień audio, ta sama ścieżka
do backendu). Data safety w Console nie wymaga edycji.

---

## 3. QA przed buildem

- `npx tsc --noEmit` — czysto (exit 0).
- Testy jednostkowe czystej logiki, wszystkie zestawy z `mobile/tools/`: **223 asercje, 0 oblanych**
  (`test-level` 28, `test-speaker-label` 32, `test-storage` 16, `test-transcript` 37,
  `test-segment-split` 33, `test-speaker-split` 77).
  Uruchomienie na Windows wymaga kompilacji do `C:/tmp/rec_ai_test` (nie `/tmp` z git bash —
  node rozwija ścieżkę z importu jako `C:\tmp`) plus sed dopisujący `.js` do importów.

---

## 4. Weryfikacja gotowego AAB (nie „na oko")

| Sprawdzenie | Wynik |
|---|---|
| `jarsigner -verify -certs` | `jar verified` · `CN=REC_AI, OU=Mobile, O=glue010, C=PL` — **klucz uploadowy, nie debug** |
| `base/manifest/AndroidManifest.xml` | `versionCode 9880`, `versionName 0.988`, `com.glue010.recai` |
| `base/assets/index.android.bundle` | `EXPO_PUBLIC_API_URL` = URL Railway ✅ · `EXPO_PUBLIC_APP_KEY` (64 znaki) obecny ✅ · `APP_VERSION 0.988` ✅ · zero śladu po `0.974` |
| Backend produkcyjny | `GET /health` → `{"status":"ok"}` |

Obie ciche pułapki wydania (klucz w `.env`, podpis z `~/.gradle/gradle.properties`) były na miejscu
przed buildem — `expo prebuild --clean -p android` + odtworzenie `android/local.properties`,
potem `gradlew bundleRelease` (BUILD SUCCESSFUL w 2 min 1 s, Gradle 9.3.1).

### 4.1 Dymny test — zrobiony PRZED uploadem, na tym samym artefakcie

Nie czekaliśmy na tor testowy Play: `bundletool build-apks --mode=universal` wyciągnął APK
**z tego samego `app-release.aab`**, zainstalowany na emulatorze Pixel_7_API_34 (Android 14).
`dumpsys package` potwierdza `versionCode=9880`, `versionName=0.988`.

W apce: pierwsze uruchomienie → kreator ustawień → ekran nagrywania z **realnym wolnym miejscem**
(„~6h/536MB AVAILABLE" — funkcja z 0.975 działa na sprzęcie) → nagranie 6 s → pasek „AI TRANSCRIBING
UPLOADING…" → po chwili „AI TRANSCRIBED WITH DEAPI" i nagranie z **tytułem od AI** na liście, z akcjami
ASK AI / RE-TRANSCRIBE / SHARE / DETAILS / DELETE. Zero crashy w `logcat -b crash`.
(Transkrypt jest bzdurny — emulator nie ma realnego wejścia mikrofonowego, więc Whisper halucynuje na
ciszy. To ograniczenie emulatora, nie builda; ścieżka sieciowa i zapis przeszły.)

Osobno, **kluczem wyciągniętym z `mobile/.env` — tym samym, który siedzi w bundlu** — odpytany
produkcyjny backend:

| Test | Wynik |
|---|---|
| `POST /transcriptions` bez `X-App-Key` | **401** `invalid or missing X-App-Key` (fail-closed działa) |
| `POST /transcriptions` `engine=standard` | **200**, transkrypt z czasami w tekście, `segments: 0` — zgodnie z kontraktem |
| `POST /transcriptions` `engine=advanced` | **200**, `segments[0]` ma `speaker='SPEAKER_00'` i **40 słów** z czasami |
| `POST /chat` | **200**, odpowiedź osadzona w treści notatki |
| `POST /chat` bez `X-App-Key` | **401** |

To zamyka jedyne realne ryzyko wydania (martwe AI przez brak klucza w bundlu) **przed** wysyłką na Play.

---

## 5. „Co nowego" — notatki wydania

> ⚠️ Wersja poprawiona 2026-08-17 po audycie względem kodu. Pierwsza redakcja miała punkt
> „Free space and version in Settings" — **nieprawdziwy**: wolne miejsce jest na ekranie
> nagrywania (`RecordingScreen.tsx:158`), a `SettingsScreen` w ogóle nie importuje
> `useStorageLabel`; w Ustawieniach jest tylko wersja. Punkt rozbity na dwa.

### EN (do wklejenia w Play Console, limit 500 znaków — **476/500**)
```
• Speaker names instead of numbers — picked up from the conversation (Marc → MRC)
• Sharper speakers: a turn splits on the exact word the speaker changes
• Automatic paragraphs — long walls of text become readable
• Waveform reacts across the whole range of speech
• Joystick scrolling on the recordings list
• New key icons and transcription toasts
• Real free space left, shown on the recorder
• App version in Settings
• Fix: AUTO TRANSCRIBE respects AI ENGINE and LANGUAGE
```

### PL (gdyby Console miała też polską wersję językową — 456/500)
```
• Imiona rozmówców zamiast numerów — brane z treści rozmowy (Marc → MRC)
• Dokładniejsi rozmówcy: tura tnie się na słowie zmiany mówcy
• Automatyczne akapity — długie ściany tekstu stają się czytelne
• Waveform reaguje w całym zakresie mowy
• Joystick przewija listę nagrań
• Nowe ikony klawiszy i toasty transkrypcji
• Realne wolne miejsce na ekranie nagrywania
• Wersja aplikacji w Ustawieniach
• Poprawka: AUTO TRANSCRIBE respektuje AI ENGINE i LANGUAGE
```

---

## 6. Kroki wdrożenia (Play Console)

1. **Play Console → Rec+ → Testowanie wewnętrzne** (albo od razu Produkcja).
2. **Utwórz nową wersję** → wgraj `app-release.aab`.
3. Sprawdź, że Console pokazuje **kod wersji 9880** i **nazwę wersji 0.988**.
4. Wklej „Co nowego" (sekcja 5, wersja EN).
5. Data safety — bez zmian względem 9740.
6. Zapisz → Sprawdź wersję → Rozpocznij wdrażanie.
7. Po zatwierdzeniu: instalacja z toru testowego i **dymny test na urządzeniu** —
   nagranie → transkrypcja STANDARD i ADVANCED → czat o notatce. To jedyny test, który realnie
   weryfikuje `EXPO_PUBLIC_APP_KEY` w zbudowanym artefakcie.

---

## 7. Stan spraw otwartych (aktualizacja 2026-08-17, po wykonaniu)

1. ✅ **Polityka prywatności jest live i po angielsku.** Przepisana, sprostowana względem kodu
   i wdrożona (`railway up`, commit `f6dea4a`). Weryfikacja po deployu: `lang="en"`,
   `<title>Privacy Policy — Rec+</title>`, `Last updated: 17 August 2026`, zero wystąpień
   starego „REC_AI". Szczegóły sprostowań — w wiadomości commita.
2. ✅ **Dymny test wykonany przed uploadem** — sekcja 4.1.
3. ✅ **`store/STORE_LISTING_EN.md` przepisany** dla `Rec+` 0.988: nazwa, opis pełny (3977/4000),
   „What's new" (476/500), Data safety z pełną listą uprawnień z AAB. Każde zdanie oparte na
   kodzie i skontrolowane przeciwnie (lista odrzuconych twierdzeń jest w tym pliku).
4. ⚠️ **Nazwa w Console vs nazwa na urządzeniu** — apka instaluje się jako `Rec+`, ale w środku
   wita napisem `WELCOME TO REC_AI` (`mobile/src/screens/WelcomeDialog.tsx:101`) i pokazuje
   `REC_AI` w oknie INFO oraz stopce Ustawień (`SettingsScreen.tsx:143,481`). Trzy stringi,
   ale poprawka **wymaga nowego AAB** — świadomie nie ruszane w 9880. Do 0.989.
5. ⚠️ **`SYSTEM_ALERT_WINDOW` w wydanym AAB** (z szablonu frameworka, nie z naszego kodu).
   Opisane w §8 polityki; wycięcie = `blockedPermissions` + przebudowa. Do rozważenia przy 0.989.
6. **Zmiany lokalne niezacommitowane** (stan po tej sesji): `mobile/.env.example`,
   `mobile/app.json` (wpięcie pluginu podpisu), `AGENTS.md`, `mobile/plugins/`,
   nowe ikony `rec_plus_*`. Build jest z kodu `main` **plus plugin podpisu** — plugin nie zmienia
   kodu aplikacji, tylko sposób podpisania. Nic z tej sesji nie zostało wypchnięte na `origin`.
