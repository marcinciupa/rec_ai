# REC_AI — handoff dla nowej sesji (stan: 2026-06-23)

Cel projektu: dokończyć apkę notatek głosowych z transkrypcją AI + czatem, postawić **działający backend**,
przygotować buildy pod **iOS i Android** i wypuścić do sklepów. Zasady pracy: patrz `CLAUDE.md`
(QA + code review po KAŻDYM etapie, błędy naprawiamy od razu, nic nie zostawiamy na później).

## ⚡ STAN NA 2026-06-23 — SKRÓT (reszta dokumentu = szczegóły/historia)
- **Backend:** ✅ na Railway (projekt `rec-ai-backend`, https://rec-ai-backend-production.up.railway.app) — transkrypcja+czat
  zweryfikowane E2E; czat na tanim `google/gemini-2.5-flash-lite`; polityka prywatności pod `/privacy`; sekrety = Railway vars.
  (memory: `railway-backend-deploy`)
- **Apka (mobile):** ✅ Fazy 2+3 — trwałość (SQLite + audio w `documentDirectory`), realna transkrypcja (`useTranscription`),
  czat o notatce (`ChatView`: pytania głosem + presety). Apka celuje w Railway (`mobile/.env`).
- **Android:** ✅ podpisany **AAB** zbudowany lokalnie (⚠️ wymagany pin **Gradle 8.14.3**), AI zweryfikowane E2E na realnym
  buildzie. Keystore: `../credentials/recai-upload.keystore` (⚠️ ZBACKUPOWAĆ). **Expo Go NIE odpala AI** (piaskownica FS).
  (memory: `android-local-dev-build`)
- **ZOSTAJE:** user wgrywa AAB → Play internal testing (App Signing, testerzy, Data safety; uzupełnić nazwę+e-mail w
  `backend/src/privacy.html`); iOS (Mac/Apple/EAS); EAS chmura zablokowana (Marcin musi dodać pietrus914 do projektu Expo).

---

## 1. Co to za projekt (ustalone z kodu)
- `mobile/` — apka **Expo SDK 56** (RN 0.85, React 19). Skeuomorficzny dyktafon, 3 tryby
  (RECORDING / PLAYBACK / SETTINGS) jako maszyna stanów w `App.tsx` (bez expo-router).
  - **Działa naprawdę (natywnie):** nagrywanie `expo-audio` (AAC ADTS mono 44.1k/96k, mute/pauza segmentami,
    realne metering→fala), odtwarzanie, ustawienia w AsyncStorage, 4 motywy, tilt, haptyka.
  - **Zamockowane:** transkrypcja AI (licznik 0→100% + losowy tytuł), czat (nie istnieje), storage „~311h", STEREO/UHQ.
  - **Braki:** nagrania NIE są trwałe (`useRecordings` = in-memory `useState`, znika po restarcie); audio w
    `cacheDirectory` (OS może skasować); brak `expo-sqlite`, `device_id`, `lib/api.ts`.
- `backend/` — **NOWY, zbudowany w tej sesji** (FastAPI, bezstanowy proxy). Patrz niżej.
- `STACK.md` — plan architektury (pod SDK 55; realna apka SDK 56 — traktować jako wzorzec, weryfikować z kodem).

## 2. Co jest URUCHOMIONE teraz (procesy w tle)
- **Backend**: `backend/` przez `docker compose up` → `http://localhost:8001` (kontener `backend-api-1`).
- **Tunel cloudflared**: `C:\Users\pietr\Documents\rec_ai\cloudflared.exe tunnel --url http://localhost:8001`
  → **`https://downloaded-integrated-risks-anthony.trycloudflare.com`** (URL TYMCZASOWY — zmienia się po restarcie cloudflared!).
- Mobile dev server (Expo web) był uruchamiany na `:8081` (`mobile/ npm run web`) — mógł już nie żyć.
- Pliki testowe: `rec_ai/test_speech.mp3` (mowa, audio/mpeg), `rec_ai/jfk.wav`, `rec_ai/cloudflared.exe`.

## 3. Backend — co zostało zrobione ✅
Bezstanowy proxy: deAPI (Whisper) + OpenRouter (czat). Trzyma klucze, nic nie przechowuje, loguje tylko metadane.
- Endpointy: `GET /health`, `POST /api/v1/transcriptions` (multipart audio, `X-Device-Id`, webhook-driven BEZ pollingu),
  `POST /api/v1/webhooks/deapi` (HMAC + waiter resolve, idempotentny), `POST /api/v1/chat` (OpenRouter).
- **Zweryfikowane realnie:**
  - ✅ **Transkrypcja działa** — wysłane audio → deAPI zwróciło poprawny transkrypt (*"Ask not what your country…"*).
  - ✅ **Czat działa** — realne odpowiedzi PL (gemini-2.5-flash), koszt śledzony.
  - ✅ Kontrakty: 401 (brak device-id), 413 (limit), 422 (walidacja), HMAC poprawny→200, duplikat→idempotentny.
- **Bugi znalezione w QA i naprawione od razu:** UTF-8 w odpowiedziach (httpx zgadywał charset), wyciek pamięci
  waiterów (przepisane na TTL + sweeper), walidacja 500→422, HMAC porównanie na bajtach, SSRF/wyciek klucza w
  `fetch_result_url` (dokładny host match).
- **Code review** (agent code-reviewer) zrobione; security review też — temp-debug (auth bypass + HMAC oracle)
  został USUNIĘTY, weryfikacja HMAC znów bezwarunkowa.

## 4. ✅ ROZWIĄZANE (2026-06-23) — webhooki deAPI działają E2E
**Co naprawiło:** (1) nowy `DEAPI_WEBHOOK_SECRET` z panelu deAPI (poprzedni był zły → `signature mismatch`);
(2) nowy tunel cloudflared + re-save webhooka w panelu na aktualny URL (stary `trycloudflare` wygasł);
(3) **bug w kodzie**: `log.info("deapi_webhook", …, event=…)` kolidowało z zarezerwowanym argumentem `event`
structloga → `TypeError` → **HTTP 500 na KAŻDYM webhooku** (deAPI retry/backoff). Fix: kwarg `event` → `deapi_event`
w `backend/src/routers/webhooks.py` (3 miejsca).
**Zweryfikowane realnie:** `test_speech.mp3` → webhooki `job.processing` + `job.completed` oba **200 OK**,
transkrypt wrócił do klienta, zero 500. Code review (agent) czysty: HMAC-first, idempotencja, SSRF na `result_url`
zamknięte (exact-host match).
⚠️ deAPI waliduje typ pliku po **zawartości (magic bytes)**, nie po deklarowanym MIME — `.wav` bywa wykrywany jako
`audio/x-wav` i ODRZUCANY (422); `.mp3` (audio/mpeg) i `.aac` (audio/aac — format apki) przechodzą.

### Historia / jak ustalano (zostawione jako referencja):
Ustalone empirycznie:
- deAPI **transkrybuje OK** (czasem szybko ~16 s, czasem ~2 min — czas mocno się waha).
- Transkrypcja audio z pliku = **v2 multipart** `POST /api/v2/audio/transcriptions`, pole `source_file`,
  `model=WhisperLargeV3`, typy: audio/aac, audio/mpeg, audio/mp4, audio/wav, audio/ogg, audio/flac, audio/webm…
  (v1 `/api/v1/client/aud2txt` przyjmuje TYLKO URL Twitter Spaces — nie pliki.)
- Wynik: webhook payload `{event, data:{job_request_id, status, result_url, ...}}`; transkrypt NIE inline —
  pobiera się z `result_url` (.txt, format `[m:ss - m:ss]  tekst`). Status też przez `GET /api/v2/jobs/{id}`.
- **Per-request `webhook_url` jest IGNOROWANY** — webhook.site z per-request dostał 0 (3 próby).
- **Działa tylko GLOBALNY webhook z panelu** `app.deapi.ai/settings/webhooks`. Dotarł raz (gdy user ustawił
  globalny na nasz tunel), dostał od nas **401 signature mismatch** → deAPI wpadło w **backoff** (stop dostaw).
- Schemat HMAC (z docs, zaimplementowany w `security.py`): `sha256=HMAC_SHA256(secret, f"{timestamp}.{raw_body}")`,
  nagłówki `X-DeAPI-Signature`, `X-DeAPI-Timestamp`, `X-DeAPI-Event`, `X-DeAPI-Delivery-Id`, okno ±300 s.

### Co jest potrzebne od usera (czekamy):
1. **Dokładny Secret z panelu deAPI** (`app.deapi.ai/settings/webhooks`) — `signature mismatch` wynika
   najpewniej z tego, że secret w panelu ≠ `69c1…` (to z `.env` mogło być tylko do webhook.site). Po wstawieniu
   właściwego sekretu do `backend/.env` (`DEAPI_WEBHOOK_SECRET`) schemat z docs powinien pasować.
2. **Re-save** globalnego webhooka w panelu na `https://advice-devoted-lets-sorry.trycloudflare.com/api/v1/webhooks/deapi`
   (czyści backoff). UWAGA: URL tunelu się zmienia — przy nowej sesji najpewniej trzeba odpalić nowy tunel
   i podać userowi nowy adres do panelu.

### Gdyby poprawny secret nadal nie pasował:
Bezpieczny capture: user ustawia globalny webhook tymczasowo na świeży `webhook.site` → odczytać dokładny
`X-DeAPI-Signature` + `X-DeAPI-Timestamp` + raw body przez API webhook.site → policzyć HMAC offline różnymi
schematami (ts.body / body / ts+body / body.ts), znaleźć pasujący, zlockować `security.py`. **Nie** wyłączać
weryfikacji na naszym backendzie (security!).

### Otwarta decyzja architektoniczna (po odblokowaniu webhooków):
deAPI bywa wolne (~2 min) > okno `deapi_result_wait_s` (120 s). Request może zwrócić `processing`. Trzeba zdecydować:
(a) wydłużyć okno trzymania requestu, albo (b) async: zwracać 202 + dostarczać wynik przez **SSE/push** (bez pollingu,
zgodnie z wymogiem usera). Waiter już trzyma wynik z TTL i ma `get_result()` — gotowe pod oba warianty.

## 5. Klucze / sekrety
W `backend/.env` (gitignored): `DEAPI_API_KEY`, `OPENROUTER_API_KEY` (oba działają, deAPI saldo ~$8.74),
`DEAPI_WEBHOOK_SECRET`, `API_PUBLIC_URL` (= URL tunelu). **Nie commitować.** Nowy URL tunelu → zaktualizować `API_PUBLIC_URL`.

## 6. Co jeszcze do zrobienia (kolejność)
- [x] **Webhook E2E DZIAŁA** (pkt 4, 2026-06-23) — secret + re-save + fix buga `event=`/structlog. Realny test audio→webhook→transkrypt OK (200).
- [x] **Faza 2 — trwałość danych w apce ✅ (2026-06-23):** `expo-sqlite` (recordings/transcripts/messages,
      migracje przez `PRAGMA user_version`) w `mobile/src/lib/db.ts` (+`db.web.ts` AsyncStorage do podglądu web);
      audio przenoszone z cache do `documentDirectory/recordings/<id>.aac` (`recordingFiles.ts`; GC osieroconych
      plików przy starcie → UNDO zachowuje audio w sesji); `device_id` w SecureStore (`deviceId.ts`, web→AsyncStorage);
      `lib/api.ts` (upload + chat + retry, nagłówek `X-Device-Id`, baza z `EXPO_PUBLIC_API_URL`). `useRecordings`
      przepisany na bazę — API store bez zmian (ekrany nietknięte poza zapisem pliku w `RecordingScreen`).
      Zapisy do DB serializowane kolejką (porządek delete/undo). QA: `tsc` czysty, web bundle OK, web runtime
      0 błędów konsoli (seed w localStorage potwierdzony). Code review (agent) czysty — API v56 zweryfikowane z typami.
      ⚠️ Natywny runtime (SQLite/SecureStore/move pliku) DO POTWIERDZENIA na Expo Go / dev build (tu nie uruchamialny).
- [~] **Faza 3 — podłączyć AI w apce (W TOKU):**
  - [x] **3a — realna transkrypcja ✅ (2026-06-23):** `mobile/src/hooks/useTranscription.ts` (lifted w `App.tsx`,
    dzielony przez oba ekrany) — upload przez `api.transcribe` → backend; maszyna stanów uploading→processing→
    done/failed, „pełzający" %, zapis transkryptu w SQLite (`transcripts`), tytuł z transkryptu, resume przerwanych
    (`processing`) po restarcie. Mocki w RecordingScreen (AUTO TRANSCRIBE on save) i PlaybackScreen (TRANS-CRIBE)
    zastąpione realem; TRANS-CRIBE zablokowany dla demo bez pliku. `EXPO_PUBLIC_API_URL` w `mobile/.env`
    (= URL tunelu; zmienić przy nowym tunelu + restart `expo start`). QA: `tsc`/web bundle/web runtime czyste,
    code review czysty. ⚠️ Natywny E2E uploadu DO POTWIERDZENIA na urządzeniu (Expo Go + tunel).
  - [x] **3b — czat o notatce ✅ (2026-06-23):** wybrano „głos + gotowe pytania". `src/hooks/useChat.ts` (kontekst
    = transkrypt + historia z SQLite `messages`, wysyłka do `/chat`, trwałe wiadomości) + `src/screens/ChatView.tsx`
    (pod-widok PLAYBACK `view='CHAT'`): 3 kafelki SUMMARY/KEY POINTS/TASKS + pytanie GŁOSEM (klawisz ASK/VOICE →
    nagraj → transkrypcja pytania przez `api.transcribe` → `/chat`; ⏺ jest globalnie przejęty na „nowe nagranie").
    Wejście „ASK AI" w odtwarzaczu tylko dla notatek transcribed+uri. QA: tsc/web bundle/runtime czyste; code review
    czysty (ships as-is). ⚠️ Natywny E2E (głos + czat) DO POTWIERDZENIA na urządzeniu.
  - **Faza 3 KOMPLETNA** (3a+3b), **zweryfikowana E2E na natywnym buildzie Androida (2026-06-23):** nagranie → upload
    (`expo-file-system/legacy uploadAsync`) → Railway → deAPI → transkrypt (webhook 200, `has_text=true`).
    ⚠️ **AI NIE działa w Expo Go** (piaskownica expo-file-system vs expo-audio `cache/Audio/`); działa tylko w realnym
    buildzie. Build lokalny: `npx expo run:android` + **pin Gradle 8.14.3** (Expo 56 daje 9.3.1 → psuje foojay/RN 0.85;
    `android/gradle/wrapper/gradle-wrapper.properties`). Szczegóły: memory `android-local-dev-build`. Naprawione bugi
    natywne: upload (`Unsupported FormDataPart` → legacy uploadAsync), persist (move scoped-perm → legacy moveAsync),
    pusty transkrypt → `(NO SPEECH)`. Mikrofon: nadać uprawnienie w runtime (telefon: „Allow").
- [ ] **Faza 4 — przygotowanie pod sklepy:** `app.json` dodać `ios.bundleIdentifier=com.glue010.recai`;
      `eas.json` wypełnić `submit.production`; podpiąć `EXPO_PUBLIC_API_URL` (prod backend).
- [~] **Faza 5 — buildy:** ✅ **Android: podpisany AAB zbudowany lokalnie (2026-06-23)** —
      `gradlew :app:bundleRelease -x lint -x lintVitalRelease -x test` (lintVitalRelease się wywala na tym toolchainie).
      AAB: `mobile/android/app/build/outputs/bundle/release/app-release.aab` (~58 MB), podpis kluczem uploadowym
      `recai-upload` (CN=REC_AI). Keystore: `C:\Users\pietr\Documents\rec_ai\credentials\recai-upload.keystore`
      (hasło: `~/.gradle/gradle.properties` `RECAI_UPLOAD_*` + `credentials/KEYSTORE_INFO.txt`) — ⚠️ ZBACKUPOWAĆ.
      Czat na tanim modelu `google/gemini-2.5-flash-lite` (Railway var `LLM_CHAT_MODEL` + config.py). EAS chmura wciąż blokada konta.
      ZOSTAJE (user): wgrać AAB → Play Console internal testing (App Signing, testerzy), polityka prywatności + data safety
      (mikrofon; audio → backend → deAPI/OpenRouter, backend nic nie przechowuje). iOS: nadal potrzebny Mac/EAS + Apple Dev.
- [x] **Deploy backendu na Railway ✅ (2026-06-23):** projekt `rec-ai-backend` (workspace „Pietrus914's Projects"),
      build z `Dockerfile`, stały URL **`https://rec-ai-backend-production.up.railway.app`**. Sekrety jako **Railway
      variables** (nie w repo). `/health` OK (deapi+openrouter configured, webhook_secret_set), czat zweryfikowany
      w PROD (gemini-2.5-flash). `mobile/.env` → ten URL. Redeploy: `cd backend && railway up --ci`.
      ⏳ ZOSTAJE (user, jednorazowo): ustawić GLOBALNY webhook deAPI w panelu na
      `https://rec-ai-backend-production.up.railway.app/api/v1/webhooks/deapi` → wtedy transkrypcja E2E bez tunelu.

## 7. Blokery zewnętrzne / decyzje usera
- **Konto Expo:** user = `pietrus914`, ale projekt EAS należy do `marcinciupa` (wspólnik) i pietrus914 NIE ma
  dostępu (`Entity not authorized`). Przed buildami: Marcin zaprasza pietrus914 / organizacja Expo / przepięcie. iOS bundle = `com.glue010.recai`.
- **Apple Developer Program** ($99/rok) i **Google Play** ($25) — potrzebne do sklepów (status nieznany).
