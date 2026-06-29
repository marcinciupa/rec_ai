"""POST /api/v1/webhooks/deapi — callback deAPI po zmianie stanu transkrypcji.

Weryfikuje HMAC, a dla zdarzeń terminalnych odblokowuje oczekujący request (waiters.resolve).
Payload deAPI: {event, delivery_id, timestamp, data:{job_request_id, status, job_type, result_url?, error_*?}}.
Transkrypt NIE jest inline → pobieramy z result_url. Idempotentny, szybko zwraca 200."""
import json

import structlog
from fastapi import APIRouter, Header, HTTPException, Request

from ..security import verify_deapi_signature
from ..services.deapi import _extract_request_id, parse_transcript_payload

router = APIRouter(tags=["webhooks"])
log = structlog.get_logger()

_MAX_WEBHOOK_BYTES = 1024 * 1024  # 1 MB — webhook to metadane (+ ewentualnie krótki wynik); reszta za result_url


@router.post("/webhooks/deapi")
async def deapi_webhook(
    request: Request,
    x_deapi_signature: str | None = Header(default=None),
    x_deapi_timestamp: str | None = Header(default=None),
    x_deapi_event: str | None = Header(default=None),
) -> dict:
    settings = request.app.state.settings
    # ODRZUĆ duże body ZANIM je zbuforujemy (endpoint jest nieuwierzytelniony do czasu HMAC → inaczej
    # wielogigabajtowy POST wyczerpałby pamięć). Najpierw Content-Length, potem twardy limit po odczycie.
    clen = request.headers.get("content-length")
    if clen and clen.isdigit() and int(clen) > _MAX_WEBHOOK_BYTES:
        raise HTTPException(status_code=413, detail="webhook body too large")
    raw = await request.body()
    if len(raw) > _MAX_WEBHOOK_BYTES:
        raise HTTPException(status_code=413, detail="webhook body too large")

    ok, err = verify_deapi_signature(
        secret=settings.deapi_webhook_secret,
        raw_body=raw,
        signature_header=x_deapi_signature,
        timestamp_header=x_deapi_timestamp,
        tolerance_s=settings.deapi_webhook_tolerance_s,
    )
    if not ok:
        log.warning("deapi_webhook_rejected", reason=err)
        raise HTTPException(status_code=401, detail=f"invalid webhook: {err}")

    try:
        payload = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid json")

    request_id = _extract_request_id(payload)
    if not request_id:
        raise HTTPException(status_code=400, detail="no request_id in webhook")

    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    event = (payload.get("event") or x_deapi_event or "").lower()
    status = (data.get("status") or "").lower()
    waiters = request.app.state.waiters

    # Niepowodzenie
    if status in ("error", "failed") or event.endswith("failed"):
        msg = data.get("error_message") or data.get("error_code") or "transcription failed"
        delivered = waiters.resolve(request_id, {"error": msg})
        log.info("deapi_webhook", request_id=request_id, deapi_event=event, status="error", delivered=delivered)
        return {"ok": True}

    # W toku — potwierdź, nie rozwiązuj
    if status == "processing" or event.endswith("processing"):
        log.info("deapi_webhook", request_id=request_id, deapi_event=event, status="processing")
        return {"ok": True}

    # Zakończone — transkrypt jest za result_url (jednorazowy GET artefaktu, nie polling statusu)
    parsed = parse_transcript_payload(payload)
    if parsed.get("transcript") is None:
        result_url = data.get("result_url") or payload.get("result_url")
        if result_url:
            try:
                fetched = await request.app.state.deapi.fetch_result_url(result_url)
                parsed = parse_transcript_payload(fetched)
            except Exception as e:  # noqa: BLE001 — log metadanych, nie blokujemy webhooka
                log.warning("deapi_result_fetch_failed", request_id=request_id, error=str(e))
                delivered = waiters.resolve(request_id, {"error": f"result fetch failed: {e}"})
                return {"ok": True}

    delivered = waiters.resolve(request_id, parsed)
    log.info(
        "deapi_webhook",
        request_id=request_id,
        deapi_event=event,
        status="done",
        delivered=delivered,
        has_text=parsed.get("transcript") is not None,
    )
    return {"ok": True}
