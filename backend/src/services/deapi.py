"""Klient deAPI — submit transkrypcji z webhookiem (BEZ pollingu) + parsowanie wyniku.

UWAGA: dokładny kształt requestu/odpowiedzi deAPI jest do potwierdzenia żywym kluczem.
Publiczne docs: v1 POST /api/v1/client/aud2txt (audio_url, include_ts, model) → request_id +
request-status/{id} → result_url. STACK.md §18: v2 POST /api/v2/audio/transcriptions (source_file
multipart, webhook_url+webhook_secret RAZEM). Endpoint/pola są sterowane configiem — łatwo przełączyć."""
import ipaddress
import json
from urllib.parse import urlsplit

import httpx


class DeApiError(Exception):
    pass


def _is_internal_host(hostname: str | None) -> bool:
    """Blokada SSRF: odrzuć localhost / literalne prywatne/loopback/link-local IP (np. 169.254.169.254).
    Nazwy domenowe przepuszczamy (wyniki idą z presigned CDN deAPI; webhook i tak jest pod HMAC)."""
    if not hostname:
        return True
    h = hostname.lower()
    if h == "localhost" or h.endswith(".localhost") or h.endswith(".internal"):
        return True
    try:
        ip = ipaddress.ip_address(h)
    except ValueError:
        return False  # nazwa domenowa — nie blokujemy
    return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast


_ID_KEYS = ("job_request_id", "request_id", "id", "requestId")


def _extract_request_id(payload) -> str | None:
    """request_id bywa na top-level (odpowiedź submit) lub w data.job_request_id (webhook)."""
    if not isinstance(payload, dict):
        return None
    for key in _ID_KEYS:
        if payload.get(key):
            return str(payload[key])
    data = payload.get("data")
    if isinstance(data, dict):
        for key in _ID_KEYS:
            if data.get(key):
                return str(data[key])
    return None


def parse_transcript_payload(payload) -> dict:
    """Best-effort wyciągnięcie {transcript, segments, language} z body deAPI (webhook/result).
    Kształty bywają różne — potwierdzić realnym webhookiem i zablokować."""
    if not isinstance(payload, dict):
        return {"transcript": str(payload) if payload else None, "segments": None, "language": None}
    data = payload
    for key in ("result", "data", "output"):
        if isinstance(payload.get(key), dict):
            data = payload[key]
            break
    text = data.get("transcript") or data.get("text") or data.get("transcription")
    segments_raw = data.get("segments") or data.get("chunks")
    segments = None
    if isinstance(segments_raw, list):
        segments = []
        for s in segments_raw:
            if not isinstance(s, dict):
                continue
            start, end = s.get("start"), s.get("end")
            ts = s.get("timestamp")
            if start is None and isinstance(ts, list) and len(ts) == 2:
                start, end = ts[0], ts[1]
            segments.append({"start": start, "end": end, "text": s.get("text") or s.get("transcript") or ""})
    return {"transcript": text, "segments": segments, "language": data.get("language")}


class DeApiClient:
    def __init__(self, settings):
        self.s = settings
        self._client = httpx.AsyncClient(
            base_url=settings.deapi_base_url, timeout=httpx.Timeout(settings.deapi_timeout_s)
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    def _auth(self) -> dict:
        if not self.s.deapi_api_key:
            raise DeApiError("DEAPI_API_KEY not configured")
        return {"Authorization": f"Bearer {self.s.deapi_api_key}"}

    async def list_models(self) -> dict:
        """Pomocniczo do weryfikacji sluga modelu (WhisperLargeV3) realnym kluczem."""
        r = await self._client.get("/api/v2/models", headers=self._auth())
        r.raise_for_status()
        return r.json()

    async def submit_transcription(self, *, filename: str, data: bytes, mime: str, language: str | None = None) -> str:
        """Zgłasza plik audio (multipart) do transkrypcji z callbackiem webhook. Zwraca request_id.
        deAPI przyjmuje plik wprost, woła nasz webhook po zakończeniu — nie pollujemy.
        webhook_url + webhook_secret MUSZĄ iść RAZEM i być HTTPS."""
        webhook_url = self.s.webhook_url
        if not webhook_url or not self.s.deapi_webhook_secret:
            raise DeApiError(
                "webhook not configured: ustaw API_PUBLIC_URL (lub DEAPI_WEBHOOK_URL_OVERRIDE) "
                "oraz DEAPI_WEBHOOK_SECRET — przepływ tylko-webhook, bez pollingu"
            )
        form = {
            "model": self.s.deapi_model,
            "include_ts": "true",
            "webhook_url": webhook_url,
            "webhook_secret": self.s.deapi_webhook_secret,
        }
        if language:
            form["language"] = language
        files = {"source_file": (filename, data, mime)}
        try:
            r = await self._client.post(self.s.deapi_transcribe_path, headers=self._auth(), data=form, files=files)
        except httpx.HTTPError as e:
            raise DeApiError(f"submit request failed: {e}")
        if r.status_code >= 400:
            raise DeApiError(f"deAPI {r.status_code}: {r.text[:300]}")
        try:
            payload = json.loads(r.content)
        except ValueError:
            raise DeApiError(f"deAPI returned non-JSON (2xx): {r.text[:200]}")
        request_id = _extract_request_id(payload)
        if not request_id:
            raise DeApiError(f"no request_id in deAPI response: {r.text[:200]}")
        return request_id

    async def fetch_result_url(self, url: str) -> dict:
        """Jednorazowe pobranie artefaktu wyniku, gdy webhook podaje result_url zamiast treści inline.
        To NIE jest polling statusu — to pobranie gotowego wyniku."""
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise DeApiError(f"invalid result_url scheme/host: {url[:80]}")
        if _is_internal_host(parsed.hostname):
            raise DeApiError("result_url host not allowed (internal/loopback)")
        # Klucz dołączamy WYŁĄCZNIE gdy host == host deAPI API (dokładnie, nie prefiks → brak wycieku
        # klucza na api.deapi.ai.evil.com). Wyniki idą z presigned results.deapi.ai (bez auth).
        api_host = urlsplit(self.s.deapi_base_url).hostname
        headers = self._auth() if parsed.hostname == api_host else None
        r = await self._client.get(url, headers=headers)
        r.raise_for_status()
        if "application/json" in r.headers.get("content-type", ""):
            try:
                return json.loads(r.content)  # bytes→UTF-8, nie zgadujemy charsetu
            except ValueError:
                raise DeApiError("result_url returned invalid JSON")
        return {"transcript": r.content.decode("utf-8", "replace")}
