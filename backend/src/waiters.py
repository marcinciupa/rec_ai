"""Rejestr oczekiwań na webhook deAPI (in-process).

Request transkrypcji rejestruje `request_id` i czeka na asyncio.Event; handler webhooka
go ustawia z wynikiem. Brak pollingu. Wyniki trzymane z TTL (idempotencja + odbiór spóźnionego
webhooka), porządkowane przez sweep z lifespan. Jeden proces uvicorn — przy wielu replikach
trzeba przenieść do Redis pub/sub (STACK.md §6.1)."""
import asyncio
import time


class WebhookWaiters:
    def __init__(self, result_ttl_s: int = 900) -> None:
        self._events: dict[str, asyncio.Event] = {}  # tylko gdy ktoś aktywnie czeka
        self._results: dict[str, tuple[dict, float]] = {}  # request_id -> (result, ts); też idempotencja
        self._ttl = result_ttl_s

    def resolve(self, request_id: str, result: dict) -> bool:
        """Zapisuje wynik i budzi ewentualnego czekającego. False = już dostarczone (idempotentnie)."""
        if request_id in self._results:
            return False
        self._results[request_id] = (result, time.time())
        ev = self._events.get(request_id)
        if ev is not None:
            ev.set()
        return True

    async def wait(self, request_id: str, timeout: float) -> dict | None:
        """Czeka na wynik webhooka. None = nie dotarł w oknie (klient dostanie status processing)."""
        existing = self._results.get(request_id)
        if existing is not None:  # webhook mógł dotrzeć zanim zaczęliśmy czekać
            return existing[0]
        ev = self._events.setdefault(request_id, asyncio.Event())
        try:
            await asyncio.wait_for(ev.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            return None
        finally:
            self._events.pop(request_id, None)  # event niepotrzebny po zakończeniu czekania
        got = self._results.get(request_id)
        return got[0] if got else None

    def get_result(self, request_id: str) -> dict | None:
        """Wynik spóźnionego webhooka (w oknie TTL), jeśli jest."""
        got = self._results.get(request_id)
        return got[0] if got else None

    def sweep(self) -> int:
        """Usuń wyniki starsze niż TTL (ogranicza pamięć; po TTL znika też idempotencja danego id)."""
        now = time.time()
        stale = [rid for rid, (_, ts) in self._results.items() if now - ts > self._ttl]
        for rid in stale:
            self._results.pop(rid, None)
        return len(stale)
