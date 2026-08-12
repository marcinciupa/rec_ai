"""POST /api/v1/transcriptions — upload audio → multipart do deAPI → czekaj na webhook (bez pollingu)."""
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

from ..deps import require_client
from ..schemas import TranscriptionResponse
from ..services.deapi import DeApiError

router = APIRouter(tags=["transcriptions"])


@router.post("/transcriptions", response_model=TranscriptionResponse)
async def create_transcription(
    request: Request,
    audio: UploadFile = File(...),
    recording_id: str = Form(...),
    language: str | None = Form(None),
    # Silnik wybiera apka (SettingsScreen → AI ENGINE). Przyjmujemy NAZWĘ z zamkniętej listy, nie slug
    # modelu — inaczej klucz apki pozwalałby zamawiać dowolny model deAPI na nasz rachunek.
    # Brak pola → "standard", żeby starsze buildy aplikacji działały bez zmian.
    engine: str = Form("standard"),
    device_id: str = Depends(require_client),
) -> TranscriptionResponse:
    settings = request.app.state.settings
    if engine not in settings.engines:
        raise HTTPException(status_code=400, detail=f"unknown engine: {engine!r} (allowed: {sorted(settings.engines)})")
    max_bytes = settings.max_upload_mb * 1024 * 1024
    # odrzuć z góry po Content-Length (zanim wczytamy całość do pamięci/dysku)
    clen = request.headers.get("content-length")
    if clen and clen.isdigit() and int(clen) > max_bytes:
        raise HTTPException(status_code=413, detail=f"audio exceeds {settings.max_upload_mb} MB")
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty audio")
    if len(data) > max_bytes:
        raise HTTPException(status_code=413, detail=f"audio exceeds {settings.max_upload_mb} MB")

    waiters = request.app.state.waiters
    client = request.app.state.deapi
    try:
        request_id = await client.submit_transcription(
            filename=audio.filename or f"{recording_id}.m4a",
            data=data,
            mime=audio.content_type or "audio/mp4",
            language=language,
            engine=engine,
        )
    except DeApiError as e:
        raise HTTPException(status_code=502, detail=f"deAPI submit failed: {e}")

    # Sterowane webhookiem: czekamy na callback deAPI. Zero pollingu.
    result = await waiters.wait(request_id, timeout=settings.deapi_result_wait_s)

    if result is None:
        # Webhook nie dotarł w oknie — klient może ponowić. (Bez fallbacku pollingowego, świadomie.)
        return TranscriptionResponse(job_id=request_id, status="processing", recording_id=recording_id, engine=engine)
    if result.get("error"):
        raise HTTPException(status_code=502, detail=f"deAPI transcription failed: {result['error']}")
    return TranscriptionResponse(
        job_id=request_id,
        status="completed",
        recording_id=recording_id,
        transcript=result.get("transcript"),
        segments=result.get("segments"),
        language=result.get("language"),
        engine=engine,
    )
