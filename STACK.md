# rec_ai — Stack, Infrastruktura, Koszty i Skalowanie (handoff dla Claude'a)

> **Cel dokumentu.** To samowystarczalny brief do zbudowania nowej apki mobilnej **`rec_ai`** w **tej samej technologii i z tymi samymi narzędziami** co istniejący projekt `zabudowa.arch`. Zawiera realny stack (zweryfikowany w kodzie `zabudowa.arch`), pełny spec transkrypcji deAPI (z OpenAPI v2), zweryfikowane **koszty** i **plan skalowania**, oraz tabelę „co kopiujemy / adaptujemy / usuwamy". Build zaczynamy w nowej sesji w tym folderze (`C:\Users\pietr\Documents\rec_ai`). **Bez ekranów/UI w tym dokumencie — tylko infra, DB, backend i warstwa danych mobile.**
>
> Konwencja: proza po **polsku**, kod/identyfikatory po **angielsku**. Źródło wzorców: `C:\Users\pietr\Documents\Planner\aplikacja mobilna zabudowa-arch`.

---

## ⛔ 0. KRYTYCZNA REGUŁA IZOLACJI
`rec_ai` to **całkowicie odrębny projekt**. Pod żadnym pozorem nie modyfikujemy istniejących projektów:
- **`zabudowa.com.pl`** (folder `Planner/zabudowa-ai/`, schema Supabase `public`, deploye Vercel/Railway/Cloudflare).
- **`zabudowa.arch`** (folder `Planner/aplikacja mobilna zabudowa-arch/`, schema Supabase `arch`, prefix Redis `arch:`, jego Railway/Supabase/EAS).

`rec_ai` ma **własne**: repo/monorepo, schema Supabase `rec_ai` (jeśli w ogóle DB), prefix Redis `rec_ai:`, własne projekty Railway/Supabase/EAS, własne klucze. `zabudowa.arch` traktujemy **tylko do odczytu** jako wzorzec — kopiujemy pliki/wzorce do nowego repo, nie edytujemy oryginału.

---

## 1. TL;DR — czym jest rec_ai
Aplikacja mobilna (Android v1) do **notatek głosowych z transkrypcją i czatem AI**:
1. **Nagrywanie** — user nagrywa notatkę głosową; ma **lokalną historię** plików audio na urządzeniu.
2. **Transkrypcja** — każda notatka jest transkrybowana przez **deAPI** (Whisper Large v3); user przegląda tekst.
3. **Czat o notatce** — przez **LLM (OpenRouter)** user rozmawia o konkretnej notatce (Q&A, podsumowania, wyciąganie zadań itp.).

**Trzy filary architektury (zapamiętaj):**
- **Treść usera żyje na urządzeniu** — audio + transkrypty + historia czatu są przechowywane lokalnie (pliki + SQLite). Backend ich **nie przechowuje**.
- **Brak logowania** — anonimowo (`device_id`).
- **Backend = cienki, bezstanowy proxy** — istnieje wyłącznie po to, by **trzymać klucze API (deAPI, OpenRouter) po stronie serwera** (nie wolno ich wkompilować w bundle apki) i forwardować żądania. Nie loguje treści.

---

## 2. Różnice rec_ai vs zabudowa.arch
| Aspekt | zabudowa.arch | **rec_ai** |
|---|---|---|
| Domena AI | obraz (FLUX img2img) + video (LTX-2) | **audio → tekst (Whisper) + czat (LLM)** |
| Przechowywanie treści | Supabase Postgres + Storage (chmura) | **na urządzeniu** (pliki + SQLite) |
| Logowanie | anon `device_id` + Supabase | **anon `device_id`, brak chmury treści** |
| Backend | stateful pipeline + arq workers + Supabase | **bezstanowy proxy** (arq/DB opcjonalne) |
| Storage chmurowy | buckety `arch-*` | **brak** (Supabase Storage niepotrzebne) |
| Media wejściowe | kamera (vision-camera), galeria | **mikrofon** (`expo-audio`) |
| Co znika | kamera, FLUX, LTX-2, montaż FFmpeg, Allegro/produkty, koncepty | — |

---

## 3. Identyfikatory projektu
| Co | Wartość |
|---|---|
| App name / Expo slug | `rec_ai` (gdyby walidacja slug marudziła: `rec-ai`) |
| Android package / iOS bundleId | `pl.recai` (bez `_` i `-` — iOS bundleId nie dopuszcza podkreślenia) |
| Supabase schema (tylko jeśli DB) | `rec_ai` (NIGDY `public`/`arch`) |
| Redis prefix (tylko jeśli kolejka) | `rec_ai:` |
| TS package scope | `@recai/shared` |
| EAS owner / projectId | nowy projekt EAS (własny `projectId`, własny owner) |
| Backend API (prod) | nowy Railway service, np. `recai-api-production-xxxx.up.railway.app` |

---

## 4. Architektura (diagram tekstowy)
```
┌─────────────────────────── TELEFON (Android) ───────────────────────────┐
│  expo-audio (nagrywanie .aac 16k/mono)                                   │
│  expo-file-system  → audio w documentDirectory/recordings/              │
│  expo-sqlite       → recordings / transcripts / messages (HISTORIA)      │
│  SecureStore       → device_id (anon)                                    │
│        │  multipart audio (≤8 MB sync / większe async)   │ JSON czat     │
└────────┼─────────────────────────────────────────────────┼──────────────┘
         ▼                                                   ▼
┌──────────────────── BACKEND (FastAPI na Railway) — BEZSTANOWY PROXY ─────┐
│  POST /api/v1/transcriptions  → forward do deAPI, zwróć transkrypt        │
│  POST /api/v1/chat            → forward do OpenRouter, zwróć odpowiedź     │
│  trzyma KLUCZE API • nie przechowuje treści • nie loguje treści           │
│  (opcjonalnie: Postgres `rec_ai` = analityka/config; Redis `rec_ai:` =    │
│   kolejka arq dla długich nagrań)                                         │
└────────┬───────────────────────────────────────────────┬─────────────────┘
         ▼                                                 ▼
   deAPI /api/v2/audio/transcriptions            OpenRouter /chat/completions
   (Whisper Large v3, ~$0.021/h)                 (google/gemini-2.5-flash)
```
Rdzeń (record → transcribe → chat) działa **bez bazy i bez Redis**. Postgres/Redis dokładamy dopiero przy analityce i długich nagraniach (patrz §6 Skalowalność).

---

## 5. KOSZTY — zweryfikowane (verdict: **NIE kosmiczne**)
Treść on-device ⇒ **$0** za storage/egress treści. Proxy robi ~zero CPU. deAPI Whisper jest ~17× tańszy od OpenAI. Rachunek zdominowany przez **niski zmienny koszt AI per user**.

### 5.1 Cennik (zweryfikowany 2026-06-06 — przed lockiem budżetu odśwież, ceny AI często się zmieniają)
| Usługa | Pozycja | Cena | Źródło |
|---|---|---|---|
| **deAPI** | Transkrypcja Whisper Large v3 | **~$0.021/h audio** (~$0.00035/min) | deapi.ai, docs.deapi.ai/pricing |
| deAPI | Free / minimum | $5 na start, brak min. spend / subskrypcji | docs.deapi.ai/limits-and-quotas |
| deAPI | **Rate limit Basic (bez top-up)** | **transkrypcje 1/min, 10/dzień** | docs.deapi.ai/limits-and-quotas |
| deAPI | Rate limit Premium (po dowolnym top-up) | **300 RPM, bez limitu dziennego** | docs.deapi.ai/limits-and-quotas |
| deAPI | Limity pliku | audio ≤20 MB; request ≤75 MB; ≤600 min/req | docs.deapi.ai/limits-and-quotas |
| deAPI | TTS (`/audio/speech`, faza 2) | $0.77/1M znaków | docs.deapi.ai/pricing |
| **OpenRouter** | `google/gemini-2.5-flash` | **$0.30/M in · $2.50/M out** | openrouter.ai/google/gemini-2.5-flash |
| OpenRouter | `anthropic/claude-haiku-4.5` | $1.00/M in · $5.00/M out | openrouter.ai/anthropic/claude-haiku-4.5 |
| OpenRouter | Prompt-cache read | ~0.25–0.50× input | openrouter.ai/docs prompt-caching |
| OpenRouter | **Opłata za doładowanie** | **5.5% (min $0.80)** | openrouter.ai/docs/faq |
| OpenRouter | Free tier | 20 RPM / 50 RPD — nieprzydatny prod; pay-as-you-go bez RPM cap | openrouter.ai/docs/faq |
| **Railway** | Hobby / Pro | $5/mo (wlicza $5) / $20/mo | docs.railway.com/pricing |
| Railway | Compute | $20/vCPU-mo + $10/GB-RAM-mo → 1vCPU/1GB 24/7 ≈ **$30/mo** | docs.railway.com/pricing |
| Railway | Managed Redis | bez flat fee, liczone jak compute (~$7–8/mo mały) | docs.railway.com/pricing |
| Railway | Egress | $0.05–0.10/GB | docs.railway.com/pricing |
| **Supabase** | Free / Pro | 500 MB, pauza po 7 dniach idle / $25/mo | supabase.com/pricing |
| **EAS Build** | Free / Production | **30 buildów/mo** / $199/mo | docs.expo.dev/billing/plans |
| **Google Play** | Konto dewelopera | **$25 jednorazowo**, brak opłat per-app | Google Play Console |

### 5.2 Założenia (profil „Expected")
40 notatek/MAU/mo × 3 min = **2 h transkrypcji/mo**; 50% notatek → czat × 5 tur × ~3k tok kontekstu (cache'owany) + ~400 tok output/turę.
**Zmienny koszt ≈ $0.18 / MAU / mo** = transkrypcja ~$0.04 + czat ~$0.13 (z 5.5% opłatą OpenRouter).

### 5.3 Koszt @ skala (Expected)
| MAU | Zmienny | Fixed infra | **Razem/mo** | $/user | Topologia |
|---|---|---|---|---|---|
| 100 | $18 | $5 | **~$23** | $0.23 | 1 stateless service |
| 1 000 | $180 | $5–10 | **~$195** | $0.20 | 1 service |
| 10 000 | $1 800 | $30–50 | **~$1 850** | $0.185 | +worker +Redis |
| 100 000 | $18 000 | $150–300 | **~$18 200** | $0.182 | repliki +DB +cache |

Koszt rośnie liniowo (~$0.18–0.23/user). **Fixed infra ≤ ~2% rachunku** nawet przy 100k. Wrażliwość: Low ~$0.05/MAU, Heavy ~$0.82/MAU. Jedyna pozycja, która przy Heavy@100k „eksploduje" to **output tokens OpenRouter** (~$56k). deAPI nawet przy Heavy ~$25k (Whisper tani).

### 5.4 Landminy (PRZECZYTAJ przed launchem)
1. **deAPI Basic = 1 transkrypcja/min, 10/dzień** → zrób **top-up (≥$5–10) do Premium (300 RPM) PRZED launchem**, inaczej apka padnie na drugim userze.
2. **OpenRouter** — 5.5% opłaty za każde doładowanie; free tier (20 RPM) bezużyteczny w prod → doładuj ≥$10.
3. **EAS Production $199/mo — NIE subskrybuj miesięcznie.** Używaj Free (30 buildów/mo), Production włącz tylko w miesiącu z dużą liczbą buildów.
4. Jeśli audio leci **przez** proxy → płacisz Railway egress do deAPI (groszowe przy Expected, ale rozważ direct device→deAPI dla idealnie cienkiego proxy).
5. Supabase Free pauzuje po 7 dniach idle (OK gdy jest ruch).

### 5.5 Dźwignie kosztów (ranking)
1. **On-device VAD / silence-trim** przed uploadem — tnie minuty transkrypcji o 20–30% 1:1 i zmniejsza upload. Najwyższa dźwignia, za darmo.
2. **Cap długości notatki** (~10–15 min) — ogranicza worst-case, trzyma transkrypcję w trybie sync.
3. **Cap + cache kontekstu czatu** — transkrypt jako `ephemeral` cache (0.25× input); re-wysyłka kontekstu to największy koszt czatu.
4. **Default `google/gemini-2.5-flash`** (Haiku 4.5 = 2× droższy czat).
5. **Krótsze outputy** — output kosztuje ~8× input i dominuje przy Heavy.

---

## 6. SKALOWALNOŚĆ — zweryfikowana (łatwa)
### 6.1 Skalowanie horyzontalne
Proxy jest **shared-nothing** dopóki NIE ma: in-process job-dict, in-memory rate-counterów, lokalnego zapisu plików (**nie montować `/static`**). Wtedy Railway dokłada repliki trywialnie. Klienci httpx (`DeApiClient`, `OpenRouterClient`) = singletony per-proces — OK per replika. **Jedynym wspólnym stanem jest Redis** — potrzebny dopiero przy: (a) async job-status, (b) webhook→waiter pub/sub (webhook może trafić na replikę B, a waiter działa na A — pub/sub to ogarnia), (c) cross-replica rate-limit.

### 6.2 Sync → async BEZ przepisywania (kluczowy wzorzec)
**Jeden kontrakt endpointu od dnia 1:**
```
POST /api/v1/transcriptions
  → 200 { job_id, status: "completed", transcript, segments }   # krótkie audio (sync)
  → 202 { job_id, status: "processing" }                        # długie audio (async)
GET  /api/v1/transcriptions/{job_id}
  → { job_id, status: "processing"|"completed"|"failed", transcript?, segments? }
```
**Próg sync:** audio **≤ ~60 s / ≤ ~8 MB** (round-trip mieści się w mobilnym timeoucie 90 s). Powyżej → `202 processing` + klient polluje `GET` (lub push). Ponieważ odpowiedź **zawsze** zawiera `job_id` i klient rozumie `processing`, dołożenie arq+Redis+webhook później jest **addytywne** — zero zmian kontraktu.

### 6.3 Drabina skalowania
| MAU | Co dodajemy | ~Fixed/mo |
|---|---|---|
| 0–1k | Railway Hobby + 1 stateless service; **od razu top-up deAPI→Premium i OpenRouter** | $5 |
| 1k–10k | +arq worker +Railway Redis (async długich nagrań) +Pro +rate-limit per `device_id` | +$15–30 |
| ~5k–10k | Supabase Pro (analityka, A/B modeli) — opcjonalnie | +$25 |
| 10k–50k | 2–3 repliki API (HA) + prompt/response caching | +$30–90 |
| 50k–100k | 3–4 repliki + batching + routing do najtańszego hosta Gemini | +$100–200 |
| 100k+ | multi-region; rozważ self-host Whisper gdy deAPI spend >~$3–5k/mo | — |

---

## 7. Mobile — warstwa techniczna (bez UI)
**Baza:** Expo SDK **55** / React Native **0.83.6** / React 19.2 / expo-router / Zustand / TanStack Query / NativeWind. (Wszystkie wersje 1:1 jak w `zabudowa.arch/apps/mobile/package.json`.)

### 7.1 Zależności — KEEP / ADD / DROP
**KEEP (z zabudowa.arch):**
```
expo ~55.0.24 · react-native 0.83.6 · expo-router ~55.0.14
zustand ^5.0.0 · @tanstack/react-query ^5.59.0
nativewind ^4.1.20 · tailwindcss ^3.4.13
react-native-reanimated 4.2.1 · react-native-worklets 0.7.4
react-native-gesture-handler ~2.30.0 · react-native-screens ~4.23.0 · react-native-safe-area-context ~5.6.2
expo-secure-store ~55.0.14 · expo-file-system ~55.0.20
expo-constants ~55.0.16 · expo-crypto ~55.0.15 · expo-device ~55.0.17
expo-font ~55.0.7 · expo-splash-screen ~55.0.21 · expo-status-bar ~55.0.6 · expo-linking ~55.0.15
expo-build-properties ~55.0.14 · react-native-sse ^1.2.1
@expo-google-fonts/inter · @expo-google-fonts/fraunces  (opcjonalnie — branding)
expo-notifications ~55.0.23  (TYLKO jeśli async + push)
```
**ADD (nowe dla rec_ai):**
```
expo-audio        (~55.x)  — nagrywanie + odtwarzanie (NIE expo-av — deprecated)
expo-sqlite       (~55.x)  — lokalna historia (recordings/transcripts/messages, opc. FTS5)
```
**DROP (z zabudowa.arch — niepotrzebne):**
```
react-native-vision-camera · expo-image-picker · expo-media-library
expo-image-manipulator · expo-image · expo-video · expo-task-manager (chyba że async bg)
```

### 7.2 Configi do skopiowania 1:1 (z `apps/mobile/`)
- **`babel.config.js`** — `react-native-worklets/plugin` **MUSI być LAST** w `plugins` (wymóg Reanimated 4 / SDK 55):
  ```js
  module.exports = function (api) {
    api.cache(true);
    return {
      presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
      plugins: ['react-native-worklets/plugin'], // LAST
    };
  };
  ```
- **`metro.config.js`** — monorepo watchFolders + `withNativeWind(config, { input: './global.css' })`.
- **`tailwind.config.js`** — paleta (cream/green/blue/stone/amber) + fonty (Inter/Fraunces). Można odchudzić, ale wzorzec branding-consistency jest gotowy.
- **`tsconfig.json`** — `extends expo/tsconfig.base`, `strict`, paths `@/*` + `@recai/shared`.
- **`global.css`** — `@tailwind base/components/utilities`.

### 7.3 `app.json` — kluczowe pola
```jsonc
{
  "expo": {
    "name": "rec_ai", "slug": "rec_ai", "scheme": "recai",
    "android": {
      "package": "pl.recai",
      "permissions": ["android.permission.RECORD_AUDIO"]   // CAMERA itp. USUNIĘTE
    },
    "ios": { "bundleIdentifier": "pl.recai" },              // faza 2
    "plugins": [
      "expo-router",
      "expo-secure-store",
      ["expo-build-properties", { "android": { "usesCleartextTraffic": true } }], // dev http 10.0.2.2
      ["expo-sqlite", { "enableFTS": true }],               // jeśli FTS5 (C4) — zweryfikuj na realnym buildzie Android
      ["expo-audio", { "microphonePermission": "rec_ai używa mikrofonu do nagrywania notatek głosowych." }]
      // jeśli nagrywanie w tle (C3): dodaj "enableBackgroundRecording": true do konfigu expo-audio
    ],
    "extra": { "eas": { "projectId": "<NOWY_PROJECT_ID>" } },
    "owner": "<NOWY_OWNER>"
  }
}
```

### 7.4 EAS (kopiuj wzór `apps/mobile/eas.json`, NIE root — C7)
`appVersionSource: "local"`, profile `development|preview|production`, prod `android.buildType: "app-bundle"` + `autoIncrement: true`, env per-profil `EXPO_PUBLIC_API_URL` = URL Railway prod.

### 7.5 ⚠️ C1 (KRYTYCZNE) — format nagrania
**NIE używać `RecordingPresets.HIGH_QUALITY`** — daje `.m4a` (AAC-in-MP4), którego **deAPI transkrypcja NIE przyjmuje**. deAPI audio akceptuje **wyłącznie**: `aac, mpeg, ogg, wav, webm, flac` (≤20 MB). Użyć **custom `RecordingOptions`**:
```ts
import { useAudioRecorder, RecordingOptions, AudioModule, setAudioModeAsync } from 'expo-audio';

const REC_OPTS: RecordingOptions = {
  extension: '.aac',
  sampleRate: 16000,        // Whisper i tak downmixuje do 16kHz mono (C2)
  numberOfChannels: 1,
  bitRate: 64000,           // ~480 KB/min → ~42 min do limitu 20 MB
  android: { outputFormat: 'aac_adts', audioEncoder: 'aac', extension: '.aac' },
  ios: { /* faza 2: iOS nie emituje ADTS natywnie — użyć wav/flac */ },
};
// upload jako multipart: filename '*.aac', MIME 'audio/aac'
```
**Zwaliduj round-trip na realnym `.aac` na samym START** — to najwyższe ryzyko całego projektu. Alternatywa: `outputFormat:'webm'` → `audio/webm`.

### 7.6 C3 — nagrywanie w tle (decyzja v1)
Albo: plugin `expo-audio` z `enableBackgroundRecording: true` (dodaje `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `POST_NOTIFICATIONS`) + `setAudioModeAsync({ allowsRecording: true, allowsBackgroundRecording: true, playsInSilentMode: true })`. **Albo** jawnie: v1 = nagrywanie tylko na foreground (ekran włączony) i zabezpieczyć przed wygaszeniem. **Nie zostawiać dwuznaczności** — wybrać świadomie.

### 7.7 API client (wzór `lib/api.ts`)
Skopiować wzorzec: resolucja `BASE_URL` (emulator `10.0.2.2`, prod z `EXPO_PUBLIC_API_URL`), retry **tylko** transient (TypeError/AbortError), timeouty (default 15 s, upload 90 s), nagłówek **`X-Device-Id`**, upload FormData (multipart). `device_id` z `lib/deviceId.ts` (UUID v4 w SecureStore, klucz `recai.device_id`).

---

## 8. Mobile — warstwa danych ON-DEVICE (to jest „DB" usera)
**Audio:** pliki w `FileSystem.documentDirectory + 'recordings/'` (app-private, trwałe, scoped-storage OK, bez dodatkowych uprawnień). **Nigdy `cacheDirectory`** (OS może usunąć). Przy API string-path użyć `import * as FileSystem from 'expo-file-system/legacy'` (SDK 55 quirk).

**SQLite (`expo-sqlite`, async API):** `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;` przy otwarciu.
```sql
CREATE TABLE recordings (
  id TEXT PRIMARY KEY,            -- client-generated UUID (idempotencja uploadu)
  file_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,    -- epoch ms
  duration_ms INTEGER,
  size_bytes INTEGER,            -- zapisać przy insert → SUM() = zużycie storage
  title TEXT,
  lang TEXT,
  status TEXT NOT NULL,           -- recorded|uploading|processing|transcribed|failed
  deapi_request_id TEXT
);
CREATE TABLE transcripts (
  recording_id TEXT PRIMARY KEY REFERENCES recordings(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  segments_json TEXT,             -- [{start,end,text}]
  created_at INTEGER NOT NULL
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  role TEXT NOT NULL,             -- user|assistant
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_recordings_created_at ON recordings(created_at DESC);
CREATE INDEX idx_messages_recording_created ON messages(recording_id, created_at);
-- Opcjonalnie FTS5 (C4 — wymaga ["expo-sqlite",{enableFTS:true}], zweryfikuj na Android):
-- CREATE VIRTUAL TABLE transcripts_fts USING fts5(text, content='transcripts', content_rowid='rowid');
-- + triggery synchronizujące insert/update/delete
```
**Migracje:** wersjonować przez `PRAGMA user_version` — odczytać przy otwarciu, wykonać uporządkowane kroki `ALTER`/`CREATE` w transakcji, podbić wersję.

---

## 9. Mobile — wzrost storage i sprzątanie
- Pliki audio app-private (patrz §8). Trzymać małe dzięki §7.5/C2 (16k mono ~64 kbps).
- Zużycie: `SELECT SUM(size_bytes) FROM recordings` → pokazać w ustawieniach.
- Retencja: opcje „usuń audio, zostaw transkrypt" (transkrypt to trwały artefakt) oraz „auto-usuń audio starsze niż X dni". Przy kasowaniu notatki — usuń wiersze + plik.

---

## 10. Mobile — resilience / co persystuje
- **Zapis audio + wiersz `status='recorded'` PRZED jakimkolwiek uploadem** — kill apki nigdy nie gubi nagrania.
- Transkrypcja jako maszyna stanów w SQLite: `recorded → uploading → processing(deapi_request_id) → transcribed | failed`.
- **Resume na starcie:** przy launchu przeskanować wiersze nie-terminalne i wznowić (re-upload albo re-poll `GET /transcriptions/{job_id}`) — wzór `lib/resumeGeneration.ts` + `lib/activeGeneration.ts` z zabudowa.arch.
- **Offline:** nagrywanie działa w pełni offline; transkrypcja kolejkuje się lokalnie i odpala po powrocie sieci (reuse transient-retry z `api.ts`).
- **Idempotencja:** klient wysyła własne `recording_id` → ponowiony upload nie tworzy duplikatu / nie podwaja kosztu.

---

## 11. Backend — stack
**Minimalny (rdzeń bezstanowy):** FastAPI + Pydantic v2 + `pydantic-settings` + httpx + tenacity + structlog + `python-multipart` (upload). Python **3.12**, package manager **`uv`**.
```
fastapi >=0.115 · uvicorn[standard] >=0.32 · pydantic >=2.11 · pydantic-settings >=2.6
httpx >=0.27 · tenacity >=9.0 · structlog >=24.4 · python-multipart
ruff >=0.8 · mypy >=1.13 · pytest >=8.3 · pytest-asyncio · respx   (dev)
```
**Opcjonalne (dokładać przy skalowaniu):** `sqlalchemy>=2.0.36 + asyncpg>=0.30 + alembic` (DB analityka/config), `arq>=0.26 + redis>=5.2` (kolejka async), `exponent-server-sdk` (push). **DROP z zabudowa.arch:** `Pillow`, `numpy` (brak obróbki obrazu), `supabase` (brak Storage), Allegro/Tavily.

**Szkielet do skopiowania (z `apps/api/src/`):**
- **`main.py`** — CORS, **passthrough `StarletteHTTPException` PRZED catch-all** (`@app.exception_handler(Exception)` maskuje HTTPException jako 500 bez tego), health endpoint, routery. ⚠️ **C6: usunąć eager `get_arq_pool()` z `lifespan`** i **nie montować `/static`** (rdzeń bezstanowy).
- **`config.py`** — `Settings(BaseSettings)`. ⚠️ **C6: `DATABASE_URL`/`REDIS_URL` → opcjonalne** (`str | None = None`) za flagami `USE_DB`/`USE_ASYNC`; inaczej app nie wstanie bez Postgres/Redis. Pola rdzenia: `deapi_key`, `deapi_base_url`, `deapi_timeout_s`, `openrouter_api_key`, `openrouter_base_url`, `llm_chat_model` (default `google/gemini-2.5-flash`), `api_cors_origins`, `environment`, `log_level`, `admin_token` (jeśli admin), `deapi_webhook_url`/`deapi_webhook_secret` (jeśli async).
- **`deps.py`** — TYLKO jeśli DB: async engine z `connect_args={"statement_cache_size": 0, "server_settings": {"search_path": "rec_ai"}}` (fix pgbouncer Supabase pooler).
- **`logging_context.py`** — context-var binding (`device_id`, `job_id`).

---

## 12. Backend — deAPI transkrypcja (RDZEŃ)
Patrz pełny spec w §18. Endpoint: **`POST /api/v1/transcriptions`** (multipart `audio` + `recording_id` + opc. `language`) z jednym kontraktem sync/async (§6.2). Wewnątrz: pobierz bajty z `UploadFile`, wywołaj `DeApiClient.submit_audio_transcription(source_file=(name,bytes,'audio/aac'), model='WhisperLargeV3', include_ts=True, return_result_in_response=True)`, czekaj (sync: `wait_for_job`; async: `wait_for_deapi_via_webhook`), zwróć `extract_transcript(job)`.

---

## 13. Backend — chunking długich nagrań
- **Preferowane client-side** (utrzymuje backend bezstanowy i Dockerfile slim → **drop FFmpeg**): nagrywaj w rolling-segmentach (~10 min, np. `RecordingOptionsAndroid.maxFileSize` lub timed re-arm) albo dziel istniejący długi plik na kliencie.
- Transkrybuj segmenty sekwencyjnie/równolegle; **scalaj transkrypty z offsetem `segments[].start/end` o skumulowany czas** poprzednich segmentów (trzymaj `duration_ms` per segment).
- Per-segment `request_id` + status w SQLite → niezależny retry/resume.
- Server-side FFmpeg-split tylko jako fallback (wtedy w backendzie `deapi_throttle = asyncio.Semaphore(N)` wzorem `gugik_throttle.py` z zabudowa.arch, by respektować limity współbieżności deAPI).

---

## 14. Backend — czat o notatce (LLM)
- Reuse **`OpenRouterClient`** (`apps/api/src/services/llm/router.py`) + **`build_cached_system_prompt(static=transcript_block, dynamic=None)`** → transkrypt jako breakpoint `cache_control:{type:"ephemeral"}` (cache-hity logowane przez `_cached_tokens`).
- **Cap historii:** ostatnie 8–12 tur verbatim; starsze → rolling summary (jeden dodatkowy, cache'owany call LLM).
- **RAG/embeddingi = overkill dla v1** (jedna transkrypcja mieści się w kontekście, cache tani). Cross-note „zapytaj całą bibliotekę" dopiero później — **on-device** przez `expo-sqlite` `withSQLiteVecExtension` + deAPI `Bge_M3` (bez nowej infry backendu).
- Model z env `LLM_CHAT_MODEL` (lub `config` jeśli admin), default `google/gemini-2.5-flash`.
- Endpoint **`POST /api/v1/chat`** (bezstanowy): body `{ transcript, messages[], question }` → odpowiedź JSON. **C5: streaming SSE to DODATEK** (obecny `chat()` jest buforowany `resp.json()`) — backend potrzebuje metody `stream=true` + `StreamingResponse`; RN ma już `react-native-sse` + wzór `EventSource` w `hooks/useGeneration.ts`. **Ship JSON najpierw.**

---

## 15. Backend — rate-limiting / abuse
Publiczne endpointy trzymające płatne klucze = ryzyko nadużyć. Tanie zabezpieczenia:
1. **Wymóg `X-Device-Id`** (dependency `require_device_id`).
2. **Token-bucket per device + IP** — gdy jest Redis: `INCR`+`EXPIRE` na `rec_ai:rl:{device_id}:{window}` (np. N transkrypcji/h, M czatów/min). Bez Redis limiter in-process jest słaby przy wielu replikach → dołożyć Redis gdy limity zaczną mieć znaczenie.
3. **Serwerowe ceilings** — odrzucaj >20 MB / za długie PRZED forwardem do deAPI.
4. Opcjonalnie **podpisywanie requestu** (HMAC body z app-secret w buildzie) — utrudnia replay/scraping kluczy.
5. **Miesięczny cap kosztu per device** — pre-check `deAPI /price` + tabela `events`.
6. **`deapi_throttle` semafor** — by jeden abuser nie wyczerpał konta deAPI.

---

## 16. Backend — prywatność (gwarancja)
Backend **NIGDY nie loguje**: bajtów audio, tekstu transkryptu, `segments`, treści czatu. Logi mogą zawierać **tylko**: `device_id`, `job_id`/`deapi_request_id`, status, liczbę bajtów, czas trwania, nazwę modelu, koszt, latencję. Wymusić **lint/CI grep** zakazujący `logger.*(transcript|content|text=)` w ścieżkach requestów (wzór: no-content-log job w CI).

> **Formuła gwarancji (do README/Polityki):** „Backend rec_ai jest bezstanowym proxy. Trzyma klucze API dostawców, forwarduje audio do deAPI i czat do OpenRouter — i **nie przechowuje niczego**. Logi zawierają wyłącznie metadane bez treści (device id, job id, status, rozmiary, czasy, koszt). Audio, transkrypty i treść czatu istnieją wyłącznie na urządzeniu użytkownika."

---

## 17. Infra / DevOps
- **Monorepo pnpm**: root `package.json` (workspace `apps/*` + `packages/*`), `pnpm-workspace.yaml`, `.npmrc` (`shamefully-hoist=true`, `node-linker=hoisted`), `packages/shared` (TS types, scope `@recai/shared`). pnpm 9.x.
- **`docker-compose.yml`** (TYLKO jeśli DB/kolejka) — Postgres 16 na **`:5433`**, Redis 7 na **`:6390`** (porty nietypowe, by nie kolidować). Healthchecki.
- **`Dockerfile`** — `python:3.12-slim`, `uv`, `CMD uvicorn src.main:app --host 0.0.0.0 --port ${PORT:-8001}`. ⚠️ **DROP FFmpeg** (chyba że server-side chunking, §13). Alembic upgrade w CMD tylko jeśli DB.
- **Railway** — service `api` (zawsze). Service `worker` (`uv run arq src.workers.arq_settings.WorkerSettings`) **tylko gdy async**. Managed Redis tylko gdy async. ⚠️ **Reguła dual-service env-sync**: api i worker to OSOBNE services z OSOBNYMI Variables — każda zmiana env w obu.
- **Supabase** — tylko jeśli DB; schema **`rec_ai`** (nie `public`/`arch`); **bez bucketów**.
- **Env** — root `.env` (dev) + `.env.production` (prod) + Railway Variables muszą się synchronizować (wzór `zabudowa.arch`). Rdzeń: `DEAPI_KEY`, `DEAPI_BASE_URL=https://api.deapi.ai`, `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`, `LLM_CHAT_MODEL`, `API_CORS_ORIGINS`, `ENVIRONMENT`, `API_PUBLIC_URL`. Mobile: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_ENVIRONMENT`.
- **CI/CD (GitHub Actions)** — `ci.yml`: ruff check/format + pytest + **no-content-log grep** + typecheck mobile/shared. `deploy.yml`: health-check (alembic tylko gdy DB). Railway/Vercel auto-deploy z push na main.
- **EAS / Google Play** — `eas build --platform android --profile production` (AAB, `autoIncrement` versionCode), `eas submit`. Konto Google Play $25 jednorazowo.

---

## 18. deAPI — pełny spec transkrypcji (POTWIERDZONE z OpenAPI v2)
- **`POST /api/v2/audio/transcriptions`**
  - `model` (wymagany) — np. **`WhisperLargeV3`** (potwierdzić realnym kluczem przez `list_models`).
  - `include_ts` (wymagany, bool) — timestampy.
  - `source_file` (multipart) **XOR** `source_url` — wzajemnie wykluczające.
  - `return_result_in_response` (opc., bool) — zwróć transkrypt inline zamiast tylko download URL.
  - `language` (opc.), `webhook_url` + `webhook_secret` (opc., ale **RAZEM** — inaczej 422).
  - Zwraca **`request_id`** (async). Wynik: `GET /api/v2/jobs/{request_id}` lub webhook.
  - Formaty audio: **`aac, mpeg, ogg, wav, webm, flac`** ≤20 MB; request ≤75 MB.
- **Cena:** `POST /api/v2/audio/transcriptions/price` → pasuje do `DeApiClient.calculate_price("audio","transcriptions", payload)`.
- **Webhook HMAC** (obsługiwane 1:1 przez `apps/api/src/routers/webhooks.py`): `X-DeAPI-Signature: sha256=HMAC-SHA256(secret, timestamp + "." + raw_body)` + `X-DeAPI-Timestamp` (okno ±300 s), idempotentny `SET … NX EX 3600`, publish terminal-only.
- **Nowa metoda klienta** (wzorzec `submit_image_edit_multipart` — strip Content-Type w multipart, tenacity retry, XOR-guard, webhook-pair-guard):
  ```python
  async def submit_audio_transcription(
      self, *,
      source_file: tuple[str, bytes, str] | None = None,   # (filename, bytes, mime)
      source_url: str | None = None,
      model: str = "WhisperLargeV3",
      include_ts: bool = True,
      return_result_in_response: bool = True,
      language: str | None = None,
      webhook_url: str | None = None,
      webhook_secret: str | None = None,
  ) -> str: ...   # zwraca request_id
  ```
  Reuse bez zmian: `get_job`, `wait_for_job`, `wait_for_deapi_via_webhook` (+ `polling_fallback_after_s=60`), `calculate_price`, `list_models`, `_extract_request_id`.
- **Ekstraktor** (obok `output_extractor.py`): `extract_transcript(job) -> {text, segments: [{start, end, text}]}` (przy `return_result_in_response=true` lub webhooku pełny payload jest już w zwrocie `wait_*` — bez dodatkowego fetcha).
- **Faza 2 — TTS:** `POST /api/v2/audio/speech` (czytanie notatek/odpowiedzi głosem).

---

## 19. Gotchas (przeniesione 1:1 + nowe deAPI)
- **`uvicorn --host 0.0.0.0`** (nie `127.0.0.1`) — inaczej emulator AVD nie trafi przez `10.0.2.2`.
- **`EXPO_PUBLIC_*` są inlinowane w bundle** → po zmianie `.env` ZAWSZE `expo start --clear`.
- **`expo start --offline`** — placeholder EAS `projectId` powoduje fail „EAS login required" bez tego.
- **Redis port `6390`** (lokalnie), nie 6380/6379.
- **`expo-file-system/legacy`** — string-path API (downloadAsync, documentDirectory) w SDK 55.
- **`react-native-worklets/plugin` LAST** w `babel.config.js`.
- **arq `ctx["redis"]`** nie wstrzykuje się sam — `_on_startup` musi `ctx["redis"] = redis_async.from_url(...)` (tylko gdy async).
- **webhook + polling fallback** — zawsze safety-net polling co 60 s (jeden zgubiony webhook = timeout).
- **`statement_cache_size=0`** dla Supabase pooler/pgbouncer (tylko gdy DB).
- **globalny `exception_handler(Exception)` maskuje HTTPException** → passthrough `StarletteHTTPException` przed catch-all.
- **zombie node `:8081`** — po nieudanym `expo start` bez `--offline`; zabić PID i sprawdzić `netstat`.
- **+C1 preset trap** — default `HIGH_QUALITY` = `.m4a`, odrzucane przez deAPI; musi być `aac_adts`/aac.
- **+deAPI `webhook_url`+`webhook_secret` RAZEM** (422 jeśli tylko jeden).

---

## 20. Tabela: KOPIUJ 1:1 / ADAPTUJ / USUŃ (względem zabudowa.arch)
| Element | Decyzja | Uwagi |
|---|---|---|
| `babel.config.js`, `metro.config.js`, `tailwind.config.js`, `tsconfig.json`, `global.css` | **KOPIUJ 1:1** | worklets LAST; scope `@recai/shared` |
| `lib/api.ts`, `lib/deviceId.ts` | **KOPIUJ→adapt** | endpointy transcriptions/chat; klucz `recai.device_id` |
| `lib/resumeGeneration.ts`, `lib/activeGeneration.ts` | **ADAPTUJ** | resume transkrypcji zamiast generacji |
| `services/deapi/client.py` | **KOPIUJ→add** | dodać `submit_audio_transcription` |
| `services/deapi/webhook_wait.py`, `routers/webhooks.py` | **KOPIUJ 1:1** | działa dla audio bez zmian |
| `services/deapi/output_extractor.py` | **ADAPTUJ** | dodać `extract_transcript` |
| `services/llm/router.py` (`OpenRouterClient`, cache) | **KOPIUJ→trim** | zostaw chat + cache; wyrzuć architect/researcher/prompt-engineer |
| `main.py`, `deps.py`, `config.py`, `logging_context.py` | **ADAPTUJ (C6)** | bezstanowy boot; DB/Redis opcjonalne |
| `docker-compose.yml`, `Dockerfile` | **ADAPTUJ** | drop FFmpeg; DB/Redis opcjonalne |
| `eas.json` (apps/mobile), `app.json` | **ADAPTUJ** | nowe id; RECORD_AUDIO; expo-audio/sqlite |
| `services/{concept,export,geo,...}`, FLUX/LTX-2/montaż, Allegro/Tavily, vision-camera/expo-image* | **USUŃ** | poza zakresem rec_ai |
| `Pillow`, `numpy`, `supabase`, buckety | **USUŃ** | brak obróbki obrazu / brak Storage |

---

## 21. Otwarte pytania + Pierwsze kroki

### 21.1 Otwarte pytania (decyzja na starcie budowy)
- **Start sync czy od razu async?** Rekomendacja: **sync** (próg ≤60 s/8 MB); async dołożyć bez zmiany kontraktu, gdy pojawią się długie nagrania.
- **DB w chmurze?** Rekomendacja: **bez DB na start** (w pełni bezstanowo); Supabase Free dopiero przy potrzebie analityki/admin-config.
- **Nagrywanie w tle (C3)** — w zakresie v1, czy foreground-only?
- **Potwierdzić `WhisperLargeV3`** realnym kluczem (`list_models`) + zachowanie `webhook_secret` dla audio.
- **Push** — tylko jeśli async.

### 21.2 Pierwsze kroki w nowej sesji (kolejność)
1. **Monorepo skeleton** — `apps/{mobile,api}` + `packages/shared`, pnpm workspace, `.npmrc`, skopiować configi (§7.2).
2. **Identyfikatory** — wstawić `rec_ai`/`pl.recai`/`@recai/shared`; nowy EAS `projectId`+owner.
3. **Backend rdzeń** — FastAPI bezstanowy: `config.py` (DB/Redis opcjonalne, C6), `main.py` (bez arq pool), `DeApiClient` + `submit_audio_transcription`, `OpenRouterClient` (trim), endpointy `POST /transcriptions` (sync, jeden kontrakt) i `POST /chat`. Lokalnie `uv run uvicorn src.main:app --host 0.0.0.0 --port 8001`.
4. **deAPI** — top-up do Premium; `list_models` → potwierdzić slug Whisper; test `POST /transcriptions` na przykładowym `.aac`.
5. **Mobile rdzeń** — `expo-audio` (custom `RecordingOptions` §7.5/C1), `expo-sqlite` (schema §8), `lib/api.ts` (upload + chat + poll), resume (§10). `expo start --offline --clear`.
6. **Round-trip E2E** — nagranie `.aac` → upload → transkrypt zapisany w SQLite → czat o notatce. **To jest definicja „działa".**
7. **Audyt** (po etapie) — QA + code-reviewer równolegle, fix na bieżąco (zero TODO na później).

---
*Dokument opracowany 2026-06-06 na podstawie kodu `zabudowa.arch` (zweryfikowane: package.json, app.json, eas.json, babel/metro/tailwind/tsconfig, pyproject.toml, config.py, main.py, deps.py, services/deapi/*, services/llm/*, workers/*, storage.py, docker-compose.yml, Dockerfile, .env) oraz OpenAPI v2 deAPI i cenników Railway/Supabase/EAS/OpenRouter/deAPI (2026-06-06). Ceny AI odśwież przed lockiem budżetu.*
