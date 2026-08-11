# rec_ai — project guide for Claude

Voice-notes app: skeuomorphic dictaphone (Expo/React Native) + thin stateless backend (FastAPI)
proxying **deAPI** (Whisper transcription) and **OpenRouter** (chat about a note). User content lives
on-device; backend stores nothing and logs only metadata.

## Repo layout
- `mobile/` — Expo SDK 56 app (RN 0.85, React 19). 3 modes (RECORDING/PLAYBACK/SETTINGS), state machine in `App.tsx` (no router).
- `backend/` — FastAPI stateless proxy. `docker compose up` → http://localhost:8001.
- `STACK.md` — original architecture plan (targets SDK 55; real app is SDK 56 and diverged — treat as reference, verify against code).

## ⚠️ Working agreement (REQUIRED — set by the user, 2026-06)
1. **QA after every stage.** When a stage of work is done, run QA: real tests / real run, not just "it compiles".
2. **Code review every stage.** Use the available review skills/agents (`/code-review`, `security-review`,
   `pr-review-toolkit:code-reviewer`, `verify`, `Explore`) before moving on.
3. **Fix every issue immediately.** Bugs found in QA/review are fixed on the spot — **nothing is deferred / left as a TODO**.
4. **Use skills.** Prefer the project/registry skills and subagents over ad-hoc work where they fit.
5. **Secrets only in `backend/.env`** (gitignored). Never put API keys/webhook secrets in code, CLAUDE.md, or memory.

## Run
- Backend (local): `cd backend && docker compose up --build` → `GET /health`. Env in `backend/.env` (copy from `.env.example`).
- Backend (prod): Railway project `rec-ai-backend` → https://rec-ai-backend-production.up.railway.app.
  Deploy from CLI (NOT GitHub): `RAILWAY_TOKEN=$(cat ~/.railway_token) railway up --service rec-ai-backend --ci`
  from `backend/`. Config lives in Railway variables; `railway variables --kv` prints secrets in the clear —
  pipe through `cut -d= -f1` when you only need names. In production `/health` returns just `{"status":"ok"}`
  by design (config hidden) — a richer body means a stale deploy.
- Mobile (web preview): `cd mobile && npm run web` → http://localhost:8081. Real recording only native (Expo Go / EAS dev build).
- Emulator: `~/tools/android-emu-win.sh --apk mobile/android/app/build/outputs/apk/release/app-release.apk`
  (globalny skrypt, wspólny z gallery_ai; `--metro` = `adb reverse 8081`, `--no-window`, `--stop`).
  Emulator stoi **po stronie Windows** (WHPX + `-gpu host`, natywne okno), a `adb` z WSL woła się przez
  `~/tools/adbw.sh` (tłumaczy ścieżki WSL→Windows). Wariant WSL-owy został skasowany — dlaczego, w `gallery_ai/CLAUDE.md`.

## Backend contract
- `POST /api/v1/transcriptions` — multipart `audio` + `recording_id` (+ `language`, `engine`), headers
  `X-Device-Id` + `X-App-Key` (required in production; missing/invalid → 401).
  **Webhook-driven, NO polling**: submits to deAPI with `webhook_url`+`webhook_secret`, awaits an asyncio event
  resolved by `POST /api/v1/webhooks/deapi` (HMAC-verified, idempotent).
  `engine` = **name from a closed allowlist** (`standard` | `advanced`, mapped in `config.engines`), never a
  raw deAPI model slug — otherwise the app key would let anyone order arbitrary paid models. Absent → `standard`.
  `advanced` (`WhisperLargeV3Ct2`) adds `diarize=true` + `ts_level=word` → segments carry `speaker`
  ("SPEAKER_00"…) and `words[]` with per-word timings; `standard` (`WhisperLargeV3`) returns plain text with
  timestamps glued into the string and no segments.
- `POST /api/v1/chat` — `{transcript, messages[], question}`, header `X-Device-Id` → OpenRouter.
- deAPI shape **confirmed against the live key (2026-08-11)**: v2 `POST /api/v2/audio/transcriptions`,
  file as multipart `source_file`, `webhook_url`+`webhook_secret` together. The v1-era
  `GET /api/v2/request-status/{id}` does NOT exist (404) — webhook is the only path.

## Identifiers
- Expo: app is owned by `marcinciupa` (business partner); user account is `pietrus914` (NOT yet a member → builds blocked until invited/org).
- Android package `com.glue010.recai`; iOS bundleId to use: `com.glue010.recai`.
