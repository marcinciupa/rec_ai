# Rec+ — Google Play store listing (EN)

> Gotowy do wklejenia tekst do Play Console.
> App: **Rec+** · Package: `com.glue010.recai` · Wersja: **0.988** (versionCode 9880)
> Przepisane 2026-08-17. Poprzednia wersja tego pliku opisywała `rec.ai` w wersji
> `1.0.0-beta.6 (versionCode 3)` i była nieaktualna o kilkanaście wydań.
>
> **Każde zdanie w opisie jest wzięte z kodu**, nie z pamięci: funkcje zinwentaryzowano z
> `mobile/src`, a potem osobny przebieg próbował je obalić (sekcja „Co wyleciało" na dole
> wymienia twierdzenia, które tego nie przeszły). Liczniki znaków liczone w Pythonie
> (`len()`), nie na oko.

---

## App name (max 30)
```
Rec+ — AI Voice Recorder
```
**24 / 30** ✅

> Do decyzji: na urządzeniu apka nazywa się po prostu `Rec+` (`app.json` → `expo.name`).
> Tytuł w Console może być dłuższy i to normalna praktyka, ale jeśli wolisz zero rozjazdu
> z szufladą aplikacji — wpisz samo `Rec+` (4 / 30).

## Short description (max 80)
```
Pocket dictaphone with AI: record, transcribe, and ask about your notes.
```
**72 / 80** ✅

## Full description (max 4000)
```
Rec+ is a pocket dictaphone drawn as a real gadget — brushed metal, bevelled keys, a jog wheel and a spring-loaded joystick — with AI transcription on top.

Record a note, have it turned into text, then ask questions about it. Recordings, transcripts and chats live on your device.

RECORD
• Real microphone recording, saved as a seekable .m4a file on the phone
• The red joystick nub records, pauses (timer frozen) and carries on in the same file
• A live waveform that scales itself to the last few seconds of audio, plus a level meter
• STOP saves the take, ABORT held for two seconds throws it away, PLAY opens what you just made
• RECORD MODE stereo or mono, QUALITY 192 or 64 kbps, KEEP SCREEN ON
• A real free-space readout: recording time and disk space left
• Notes name themselves from the date and a daily number

AI
• Automatic transcription when you stop, or TRANSCRIBE later; RE-TRANSCRIBE redoes it
• AI ENGINE: STANDARD for plain text, ADVANCED for speaker separation and per-word timings
• On ADVANCED: AI SPEAKERS works out who is talking when voice separation falls short, AI PARAGRAPHS splits the text by sense
• A short AI-written title names each transcribed note
• ASK AI — a chat about the note, answered from what you recorded and kept with it
• Ask by voice: tap the red nub to speak, press the metal STOP key to send
• SUMMARY and KEY POINTS preset keys, or type on the keyboard
• AI LANGUAGE English or Polish; on-screen AI status and toasts; interrupted jobs resume next launch

PLAYBACK
• The jog wheel winds the playhead at 2.5x, 5x, 7.5x or 10x, with detent clicks and a buzz at either end
• SPEED cycles 1x, 1.5x, 2x and 3x; hold it to snap back to 1x
• The joystick nudges five seconds; up and down step through paragraphs, then to the next note
• Skip keys change recording; metal STOP / BACK and PLAY / PAUSE keys

TRANSCRIPT (speaker features need AI ENGINE: ADVANCED)
• The transcript replaces the waveform and scrolls to keep the spoken line in view
• The spoken line lights up word by word where timings exist; tap a paragraph to jump there
• Speaker tiles for conversations, cut at the word the other person starts
• A name said out loud becomes a three-letter tile (Marc becomes MRC) instead of a number
• Long speech is split into timestamped paragraphs; later AI results appear in the open note

ORGANIZE & SHARE
• Every note listed with name, date and an AI badge, lit once transcribed
• Selecting one unfolds TRANSCRIBE or ASK AI, RE-TRANSCRIBE, SHARE, DETAILS and DELETE
• DELETE asks first, or fires when held; UNDO puts the note back
• SHARE hands the audio to Android's share sheet; DETAILS shows name, date, length and size
• The jog wheel flings the list and the joystick moves the selection
• Notes, transcripts, chats and settings survive a restart

LOOK & FEEL
• Four casing themes: light, dark, orange, navy
• Device view or full screen, pinch to switch; KEY ICONS swaps labels for glyphs
• Haptic keys and a joystick that clicks through detents
• HANDED swaps the outer keys for either hand; a first-run panel sets the basics

PRIVACY
• No account, no sign-up — just a random anonymous id for abuse prevention and cost control, never passed to our AI providers
• Audio stays in the app's own folder; notes, transcripts and chats in a local database
• Audio is uploaded only to transcribe it — your note, or a question you ask by voice
• Transcript text goes out for your questions and, on its own, for the title and the speaker and paragraph helpers
• The clip recorded for a spoken question is deleted as soon as it is transcribed
• HTTPS to our server, which keeps no database: audio is processed for the request then deleted; a finished transcript sits in memory up to about 25 minutes
• Deleting a note removes it from the app, and its audio at the next start; uninstalling removes everything local
• Full privacy policy: https://rec-ai-backend-production.up.railway.app/privacy

Version 0.988. Interface in English.
```
**3977 / 4000** ✅

## What's new in this version (max 500) — release notes for 0.988
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
**476 / 500** ✅

### Wariant PL (gdyby Console miała też polską wersję językową)
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
**456 / 500** ✅

---

## Privacy policy URL (pole wymagane)
```
https://rec-ai-backend-production.up.railway.app/privacy
```
Od 2026-08-17 pod tym adresem stoi angielska polityka **Rec+** (wcześniej była polska
„REC_AI" z czerwca). Zweryfikowane po deployu: `lang="en"`, tytuł `Privacy Policy — Rec+`.

---

## Data safety — odpowiedzi, każda z podparciem w kodzie

Kategorie danych nie zmieniły się od 9740, więc istniejąca deklaracja powinna nadal być
prawdziwa — to jest lista do **odhaczenia**, nie do wypełniania od zera.

**Czy apka zbiera/udostępnia dane?** Tak — audio oraz tekst transkryptu/czatu opuszczają
urządzenie w celu przetworzenia (`mobile/src/lib/api.ts`).

**Audio → „Voice or sound recordings"**: zbierane TAK, udostępniane TAK (przekazywane do
dostawcy transkrypcji, `backend/src/services/deapi.py`). Cel: wyłącznie funkcjonalność
aplikacji. Zaznacz „przetwarzane efemerycznie" — backend nie ma bazy, ORM-a ani wolumenu.
Uwaga na precyzję: upload powyżej ~1 MiB framework zrzuca do pliku tymczasowego na czas
requestu, więc bezpieczne sformułowanie to „przetwarzane przejściowo i usuwane", a nie
„trzymane w pamięci". Oznacz jako **wymagane**, nie opcjonalne: TRANSCRIPTION domyślnie
stoi na AUTO, więc nagranie leci po samym STOP-ie.

**Transkrypt i czat → „App activity / Other user-generated content"**: zbierane TAK,
udostępniane TAK (do modelu przez OpenRouter). Wysyłane, gdy zadasz pytanie **oraz
automatycznie** po transkrypcji (tytuł zawsze; rozmówcy/akapity/imiona na silniku
ADVANCED). Retencja na serwerze: wynik w pamięci procesu do ~25 min (TTL 900 s
`config.py:47` + sweeper co 450 s `main.py:26`), nigdy na dysk ani do bazy.

**Device or other IDs**: TAK — losowy identyfikator generowany w apce, trzymany w
SecureStore, wysyłany jako `X-Device-Id`. To **nie** jest Advertising ID ani identyfikator
sprzętowy. Cel: „Fraud prevention, security, and compliance" (rate limiting / kontrola
kosztu). Nie jest przekazywany dostawcom → zbierany, ale nieudostępniany.

**Szyfrowanie w tranzycie**: TAK (HTTPS; brak `usesCleartextTraffic`, webhook wymusza HTTPS).
**Usuwanie na żądanie**: TAK — kasowanie notatki w apce, sprzątanie osieroconego audio przy
starcie, odinstalowanie usuwa całą resztę. Android Auto Backup nie wynosi danych: reguły
ekstrakcji obejmują tylko domenę `sharedpref`, a baza i pliki są poza nią.
**Tracking / reklamy / sprzedaż danych / analityka**: NIE — w apce nie ma żadnego SDK
reklamowego ani analitycznego.

**Uprawnienia do uzasadnienia** — pełna lista z `bundletool dump manifest` na zbudowanym
AAB (nie z `app.json`): `RECORD_AUDIO` (jedyne, o które apka pyta), `INTERNET`,
`ACCESS_NETWORK_STATE`, `MODIFY_AUDIO_SETTINGS`, `VIBRATE`, `WAKE_LOCK`,
`FOREGROUND_SERVICE` (+`MEDIA_PLAYBACK`), `USE_BIOMETRIC`, `USE_FINGERPRINT`,
`SYSTEM_ALERT_WINDOW` oraz `READ/WRITE_EXTERNAL_STORAGE` ograniczone do `maxSdkVersion=32`.
Wszystkie są opisane w §8 polityki prywatności. `ACTIVITY_RECOGNITION` jest skutecznie
wycięte przez `blockedPermissions`.

> ⚠️ `SYSTEM_ALERT_WINDOW` („wyświetlanie nad innymi aplikacjami") wchodzi z szablonu
> frameworka, a nie z naszego kodu, i bywa punktem zaczepienia przy weryfikacji.
> Wycięcie go wymaga `blockedPermissions` w `app.json` i **przebudowania AAB**, więc
> świadomie NIE ruszaliśmy tego w wydaniu 9880 — jest opisane w polityce. Do rozważenia
> przy 0.989.

---

## Co wyleciało ze starego opisu (i dlaczego)

| Stare twierdzenie | Werdykt |
|---|---|
| Nazwa `rec.ai`, wersja `1.0.0-beta.6` | Nieaktualne — apka to `Rec+` 0.988 (9880) |
| „Pause and mute mid-recording" | MUTE zniknął z ekranu nagrywania; pauza została |
| „Motion-reactive shine and glow that shift as you tilt your phone" | **Nieprawda** — `App.tsx:263` przekazuje `motion={false}` na stałe, `useTilt` nie dotyka czujników |
| „Scrub with the jog wheel, switch between 1x and 2x speed" | Za wąskie — biegi to 1x/1.5x/2x/3x, a shuttle ma 2.5x–10x |
| „L/R level meters" (z pierwszego szkicu nowego opisu) | Wycięte — `expo-audio` daje jeden skalar, prawy kanał jest dorabiany z tej samej obwiedni (`ScreenChrome.tsx:254`) |
| „AI SPEAKERS / AI PARAGRAPHS" bez zastrzeżenia | Doprecyzowane — cały ten przebieg wymaga segmentów, czyli silnika ADVANCED |
| „a finished transcript is held … about 15 minutes" | Poprawione na ~25 min: TTL 900 s liczy się dopiero od zamiatania co 450 s |
| „Deleting a note removes it" | Doprecyzowane — wiersz znika od razu, plik audio dopiero przy następnym starcie (zostaje na UNDO) |
| „Free space and version in Settings" (w release notes) | Poprawione — wolne miejsce jest na ekranie nagrywania, w Ustawieniach jest wersja |

Nadal otwarte, bo to zmiana w kodzie, a nie w opisie: apka wita użytkownika napisem
**WELCOME TO REC_AI** (`mobile/src/screens/WelcomeDialog.tsx:101`) i pokazuje `REC_AI`
w oknie INFO oraz w stopce Ustawień (`SettingsScreen.tsx:143,481`), podczas gdy sklep i
polityka mówią `Rec+`. Poprawka to trzy stringi, ale wymaga nowego AAB.
