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
- Backend: `cd backend && docker compose up --build` → `GET /health`. Env in `backend/.env` (copy from `.env.example`).
- Mobile (web preview): `cd mobile && npm run web` → http://localhost:8081. Real recording only native (Expo Go / EAS dev build).

## Backend contract
- `POST /api/v1/transcriptions` — multipart `audio` + `recording_id` (+ `language`), header `X-Device-Id`.
  **Webhook-driven, NO polling**: submits to deAPI with `webhook_url`+`webhook_secret`, awaits an asyncio event
  resolved by `POST /api/v1/webhooks/deapi` (HMAC-verified, idempotent).
- `POST /api/v1/chat` — `{transcript, messages[], question}`, header `X-Device-Id` → OpenRouter.
- deAPI exact endpoint/fields/HMAC are config-driven; confirm against the live key and lock down.

## Identifiers
- Expo: app is owned by `marcinciupa` (business partner); user account is `pietrus914` (NOT yet a member → builds blocked until invited/org).
- Android package `com.glue010.recai`; iOS bundleId to use: `com.glue010.recai`.
