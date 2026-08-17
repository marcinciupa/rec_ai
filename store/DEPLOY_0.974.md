# Wdrożenie 0.974 (versionCode 9740) na Google Play

> Build wykonany z `main` @ `4ae47c5` (fast-forward z https://github.com/marcinciupa/rec_ai.git).
> Poprzednia wersja na sklepie: **0.9665 (9665)**.

---

## 1. Wersjonowanie — sprawdzone

| Pole | Wartość | Status |
|---|---|---|
| `expo.version` (versionName) | `0.974` | ✅ |
| `expo.android.versionCode` | `9740` | ✅ > 9665 |
| `src/version.ts` → `APP_VERSION` | `0.974` | ✅ zgodne z app.json |
| Konwencja `versionCode = round(version × 10000)` | 0.974 × 10000 = 9740 | ✅ |
| Konwencja „końcówka 0 (funkcja) / 5 (połówka)" | 9740 → `0` = zmiana funkcjonalna | ✅ |
| `applicationId` | `com.glue010.recai` | ✅ bez zmian |

**Wersji NIE podbijałem.** `main` był już na 0.974, a 9740 > 9665, więc numer jest wolny na
Play i zgodny z konwencją repo. Podbicie „na wszelki wypadek" złamałoby regułę
„bump = nowa funkcja" i zostawiło dziurę w numeracji.

⚠️ Przy uploadzie potwierdź w Play Console, że **9740 nie było użyte na żadnym torze**
(internal/closed testing też blokuje numer, nie tylko produkcja).

---

## 2. Co naprawiłem przed buildem (blokery wydania)

### 2.1 Brak `EXPO_PUBLIC_APP_KEY` — funkcje AI byłyby martwe
`mobile/.env` miał tylko `EXPO_PUBLIC_API_URL`. Od 0.973 backend jest fail-closed i wymaga
nagłówka `X-App-Key`; build bez tego klucza dostaje **401 na transkrypcji i czacie** — czyli
sklepowa wersja bez żadnej funkcji AI.

Zweryfikowane na produkcji:
- bez klucza → `401 {"detail":"invalid or missing X-App-Key"}`
- z kluczem → `200`, realna odpowiedź modelu

Klucz pobrany z Railway (`APP_API_KEY`, serwis `rec-ai-backend`) i zapisany do `mobile/.env`
jako `EXPO_PUBLIC_APP_KEY`. Plik jest gitignorowany — sekret nie trafia do repo.

> Uwaga bezpieczeństwa: `EXPO_PUBLIC_*` ląduje w bundlu, więc klucz da się wydobyć z APK.
> To bariera anty-scraping (zamyka otwarte proxy do płatnych kluczy), **nie** autoryzacja
> użytkownika. Przy rotacji trzeba zmienić go w Railway **i** wypuścić nowy build.

### 2.2 Podpis release ginął przy `prebuild --clean`
`android/` jest generowany i gitignorowany, a konfiguracja klucza uploadowego była **ręczną
edycją** `android/app/build.gradle`. Każdy `expo prebuild --clean` ją kasował i release
wychodził podpisany kluczem **debug**, którego Play odrzuca.

Zamienione na config-plugin: `mobile/plugins/withAndroidReleaseSigning.js` (wpięty w `app.json`).
Klucz i hasła zostają poza repo, w `~/.gradle/gradle.properties` (`RECAI_UPLOAD_*`).
Gdy właściwości brak → fallback na debug (build przechodzi, ale takiego artefaktu **nie wolno**
wysyłać na Play).

### 2.3 `prebuild --clean` był konieczny
Katalog `android/` był z buildu 9665 (`versionName "0.9665"`, nazwa `REC_AI`, stary
adaptive icon z `backgroundImage`). Regeneracja wymusza nowe ikony, splash i nazwę.

---

## 3. Stan zaplecza — sprawdzony na produkcji

| Element | Wynik |
|---|---|
| `GET /health` | `200 {"status":"ok"}` |
| `POST /api/v1/chat` z `X-App-Key` | `200`, poprawna odpowiedź |
| `POST /api/v1/transcriptions` z `engine=bogus` | `400 unknown engine (allowed: ['advanced','standard'])` |

Backend na Railway jest **na kodzie 0.973+** — oba silniki transkrypcji działają.
**Redeploy backendu nie jest potrzebny do tego wydania.**

---

## 4. Artefakt i jego weryfikacja

- Źródło: `mobile/android/app/build/outputs/bundle/release/app-release.aab`
- Kopia do wgrania: `~/Downloads/rec_ai-0.974-9740.aab` (~57 MB)
- Zbudowane przez: `expo prebuild --clean -p android` → `gradlew bundleRelease`
  (Gradle 9.3.1 z szablonu SDK 56, compileSdk/targetSdk 36, minSdk 24)

Sprawdzone na gotowym pliku, nie „na oko":

| Sprawdzenie | Wynik |
|---|---|
| `jarsigner -verify` | `jar verified.` |
| Podpisane przez | `CN=REC_AI, OU=Mobile, O=glue010, C=PL` — **klucz uploadowy, nie debug** |
| SHA-256 certyfikatu | `5F:FF:38:8A:C8:53:85:3A:FB:EB:1B:FF:80:7A:BA:1E:E2:37:02:D9:86:80:FC:50:A6:F3:30:FB:33:71:76:3C` |
| SHA-1 certyfikatu | `77:7D:AE:BF:1A:59:DE:E2:FB:67:E0:31:6D:E5:AE:BC:60:A6:59:C5` |
| `AndroidManifest` w AAB | zawiera `0.974` i `com.glue010.recai`, **nie zawiera** `0.9665` |
| `EXPO_PUBLIC_APP_KEY` w bundlu JS | **jest** (wraz z nagłówkiem `X-App-Key`) |
| `EXPO_PUBLIC_API_URL` w bundlu JS | **jest** (`rec-ai-backend-production.up.railway.app`) |
| `tsc --noEmit` | czysto |

⚠️ SHA-256 powyżej **musi się zgadzać z kluczem uploadowym zarejestrowanym w Play Console**
(Ustawienia → Integralność aplikacji → Podpisywanie aplikacji → certyfikat klucza przesyłania).
Jeśli się różni — upload zostanie odrzucony i trzeba użyć właściwego keystore'a,
a nie generować nowego.

---

## 5. Kroki wdrożenia (Play Console)

1. **Play Console → Rec+ → Testowanie → Testy wewnętrzne** (albo od razu Produkcja).
2. **Utwórz nową wersję** → wgraj `app-release.aab`.
3. Sprawdź, że konsola pokazuje **kod wersji 9740** i **nazwę wersji 0.974**.
4. Wklej „Co nowego" (sekcja 6).
5. **Data safety / Bezpieczeństwo danych** — bez zmian względem 9665; żadnej nowej
   kategorii danych nie doszło (silnik ADVANCED to ten sam strumień audio, tylko inny model
   po stronie dostawcy).
6. Zapisz → Sprawdź wersję → Rozpocznij wdrażanie.
7. Po zatwierdzeniu: instalacja z toru testowego i **dymny test na urządzeniu** —
   nagranie → transkrypcja (STANDARD i ADVANCED) → czat o notatce. To jedyny test, który
   naprawdę weryfikuje `EXPO_PUBLIC_APP_KEY` w zbudowanym artefakcie.

---

## 6. „Co nowego" — notatki wydania

### PL (≤500 znaków)
```
• Joystick zamiast klawiszy NEXT/MENU — gałka przesuwa zaznaczenie, środek zatwierdza
• Ikony na klawiszach zamiast napisów
• AI ENGINE w Ustawieniach: STANDARD (tekst) albo ADVANCED (rozmówcy)
• Widok transkrypcji z podziałem na rozmówców i podświetlaniem co do słowa
• RE-TRANSCRIBE — przelicz notatkę drugim silnikiem
• Nowa ikona aplikacji i ekran startowy
• Poprawki: nagrywanie zatrzymuje odtwarzanie, odsłuch od razu po nagraniu, STOP → BACK na końcu
```

### EN (≤500 znaków)
```
• Joystick navigation — the stick moves the selection, press the centre to confirm
• Icons on the keys instead of text labels
• AI ENGINE in Settings: STANDARD (text) or ADVANCED (speakers)
• Transcript view split by speaker, highlighted word by word
• RE-TRANSCRIBE — run a note through the other engine
• New app icon and splash screen
• Fixes: recording stops playback, plays back right after you stop, STOP turns into BACK at the end
```

---

## 7. Do decyzji przed publikacją — NIE zrobione w tym buildzie

To są rzeczy poza zakresem „zbuduj AAB", ale wpływają na wydanie:

1. **Nazwa aplikacji zmieniła się na urządzeniu: `REC_AI` → `Rec+`.**
   Tak jest w `app.json` na `main`. Tytuł w Play Console jest osobnym polem —
   jeśli na sklepie stoi `REC_AI` albo `rec.ai`, po tej aktualizacji nazwa w szufladzie
   aplikacji rozjedzie się z nazwą na sklepie. Do wyrównania ręcznie w Console.

2. **Polityka prywatności jest nieaktualna na żywym URL-u.**
   `https://rec-ai-backend-production.up.railway.app/privacy` serwuje wersję polską
   „REC_AI", z datą **23 czerwca 2026**. Przepisana wersja EN (`PRIVACY.md`,
   `backend/src/privacy.html`) leży **niezacommitowana** w drzewie roboczym i wymaga
   commita + `railway up` na backendzie, żeby zaczęła być widoczna. Play wymaga polityki
   odpowiadającej stanowi faktycznemu — przy zmianie nazwy na `Rec+` rozjazd jest widoczny.

3. **`store/STORE_LISTING_EN.md` jest przestarzały** — mówi o `rec.ai` i wersji
   `1.0.0-beta.6 (versionCode 3)`. Opis sklepowy do przejrzenia przed publikacją.

4. **Zmiany lokalne nie są zacommitowane** (`PRIVACY.md`, `backend/src/privacy.html`,
   `store/`, `AGENTS.md`, nowy config-plugin, `mobile/app.json`). Build jest z kodu `main`
   plus plugin podpisu — sam plugin nie zmienia kodu aplikacji, tylko sposób podpisania.
