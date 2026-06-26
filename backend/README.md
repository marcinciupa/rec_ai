# REC_AI — backend (bezstanowy proxy)

FastAPI. Trzyma klucze deAPI/OpenRouter po stronie serwera, forwarduje żądania, **nic nie przechowuje**,
loguje wyłącznie metadane (bez treści audio/transkryptu/czatu).

## Endpointy
- `GET  /health` — status + co jest skonfigurowane.
- `POST /api/v1/transcriptions` — multipart `audio` (.aac) + `recording_id` (+ opc. `language`); nagłówek `X-Device-Id`.
  Zgłasza audio do deAPI z **webhookiem** i czeka na callback (bez pollingu). Zwraca transkrypt albo `status: processing`.
- `POST /api/v1/webhooks/deapi` — callback deAPI (HMAC). Odblokowuje oczekujący request.
- `POST /api/v1/chat` — body `{ transcript, messages[], question }`; nagłówek `X-Device-Id`. Czat o notatce (OpenRouter).

## Uruchomienie (Docker)
```bash
cd backend
cp .env.example .env   # uzupełnij klucze
docker compose up --build
# http://localhost:8001/health
```
Bez Dockera: `pip install -r requirements.txt && uvicorn src.main:app --host 0.0.0.0 --port 8001`.

## Webhooki deAPI (bez pollingu) — jak to działa
1. `POST /transcriptions` zgłasza audio do deAPI z `webhook_url` + `webhook_secret` i dostaje `request_id`.
2. Request API **czeka** na `asyncio.Event` powiązany z `request_id` (do `DEAPI_RESULT_WAIT_S`).
3. deAPI po zakończeniu woła `POST /api/v1/webhooks/deapi` → weryfikacja HMAC → parsowanie → `waiters.resolve(request_id)`.
4. Czekający request budzi się i zwraca transkrypt. **Nigdzie nie pollujemy.**

### deAPI musi dosięgnąć backendu
- **Lokalnie** uruchom tunel i ustaw `API_PUBLIC_URL`:
  ```bash
  cloudflared tunnel --url http://localhost:8001     # albo: ngrok http 8001
  ```
  Wtedy `webhook_url` = `${API_PUBLIC_URL}/api/v1/webhooks/deapi`.
- **webhook.site służy tylko do PODGLĄDU** payloadu deAPI (ustaw `DEAPI_WEBHOOK_URL_OVERRIDE`).
  Przy nim pętla do apki się NIE domyka (deAPI woła webhook.site, nie nas) → request zwróci `processing`.
  Po podejrzeniu kształtu payloadu **zakomentuj override i ustaw `API_PUBLIC_URL`**.

## ⚠️ Do potwierdzenia żywym kluczem deAPI (oznaczone w kodzie)
- Endpoint transkrypcji: `DEAPI_TRANSCRIBE_PATH` (domyślnie v2 `/api/v2/audio/transcriptions`, multipart `source_file`).
  Publiczne docs pokazują też v1 `/api/v1/client/aud2txt` z `audio_url`. Po dodaniu klucza: `list_models` → potwierdź slug
  `WhisperLargeV3`, wyślij realny `.aac`, podejrzyj webhook na webhook.site i **zablokuj** parser w `services/deapi.py`
  oraz schemat HMAC w `security.py`.

## Test szybki (po `up`)
```bash
curl localhost:8001/health
# czat (wymaga OPENROUTER_API_KEY):
curl -X POST localhost:8001/api/v1/chat -H "X-Device-Id: dev1" -H "Content-Type: application/json" \
  -d '{"transcript":"Kup mleko i chleb.","messages":[],"question":"Co mam kupić?"}'
```
