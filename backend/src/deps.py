"""Wspólne zależności FastAPI: autoryzacja klienta + rate limiting.

`/chat` i `/transcriptions` trzymają płatne klucze (deAPI/OpenRouter). Bez ochrony są otwartym proxy,
które każdy z URL-em może odpalać i palić kredyty. Stąd:
 - X-App-Key: sekret współdzielony aplikacja↔backend (constant-time compare). W produkcji WYMAGANY.
 - rate limit: przesuwane okno 60 s per X-Device-Id.
X-Device-Id zostaje (anonimowy identyfikator do logów/limitu), ale NIE jest sekretem.
"""
import hmac
import time
from collections import deque

from fastapi import Header, HTTPException, Request


async def require_device_id(x_device_id: str | None = Header(default=None)) -> str:
    """Anonimowy identyfikator urządzenia — wymagany na endpointach trzymających płatne klucze."""
    if not x_device_id:
        raise HTTPException(status_code=401, detail="X-Device-Id header required")
    return x_device_id


def _check_app_key(settings, x_app_key: str | None) -> None:
    """Weryfikuj X-App-Key. Skonfigurowany → wymagany (constant-time). Brak klucza + produkcja → fail-closed."""
    key = settings.app_api_key
    if key:
        if not x_app_key or not hmac.compare_digest(str(x_app_key), str(key)):
            raise HTTPException(status_code=401, detail="invalid or missing X-App-Key")
    elif settings.environment == "production":
        # nie wolno wystawiać płatnego proxy bez klucza aplikacji
        raise HTTPException(status_code=503, detail="server misconfigured: APP_API_KEY not set")


class RateLimiter:
    """Przesuwane okno 60 s per klucz (in-memory; backend jest jednoprocesowy i bezstanowy)."""

    def __init__(self, per_min: int) -> None:
        self.per_min = per_min
        self._hits: dict[str, deque] = {}

    def check(self, key: str) -> bool:
        now = time.time()
        dq = self._hits.setdefault(key, deque())
        while dq and now - dq[0] > 60:
            dq.popleft()
        if len(dq) >= self.per_min:
            return False
        dq.append(now)
        return True

    def sweep(self) -> int:
        """Usuń puste/wygasłe wpisy (woła sweeper). Zwraca liczbę usuniętych kluczy."""
        now = time.time()
        dropped = 0
        for k in list(self._hits):
            dq = self._hits[k]
            while dq and now - dq[0] > 60:
                dq.popleft()
            if not dq:
                del self._hits[k]
                dropped += 1
        return dropped


async def require_client(
    request: Request,
    x_device_id: str | None = Header(default=None),
    x_app_key: str | None = Header(default=None),
) -> str:
    """Pełna brama dla płatnych endpointów: klucz aplikacji + device-id + rate limit. Zwraca device_id."""
    settings = request.app.state.settings
    _check_app_key(settings, x_app_key)
    device_id = await require_device_id(x_device_id)
    limiter = getattr(request.app.state, "rate_limiter", None)
    if limiter is not None and not limiter.check(device_id):
        raise HTTPException(status_code=429, detail="rate limit exceeded — slow down")
    return device_id
