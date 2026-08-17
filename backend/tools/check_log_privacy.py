"""Test regresyjny obietnicy z polityki prywatności: TREŚĆ NIGDY NIE TRAFIA DO LOGÓW.

Uruchomienie (z katalogu backend/):
    python tools/check_log_privacy.py

Dlaczego istnieje: pierwsze podejście do tej obietnicy (usunięcie `str(exc)` z handlera
`Exception` w main.py) NIE zamykało dziury. `ServerErrorMiddleware` Starlette po wywołaniu
handlera **podnosi wyjątek dalej** ("We always continue to raise the exception"), a uvicorn
łapie go i robi `logger.error("Exception in ASGI application", exc_info=exc)` — czyli
sformatowany wyjątek, z `input` Pydantica w środku, ląduje na stdout mimo naszego czystego
loga. Bez tego testu poprawka wyglądała na zrobioną, a treść dalej szła do logów Railway.

Test startuje PRAWDZIWĄ aplikację (`create_app`) pod uvicornem w podprocesie, dokłada trasę,
która wywraca walidację ODPOWIEDZI na markerze, i sprawdza, czy marker pojawił się gdziekolwiek
na stdout/stderr serwera.

⚠️ URUCHAMIAJ NA LINUKSIE (WSL/Docker — tak stoi produkcja):
    wsl -e bash -lc "cd /mnt/c/.../backend && ~/recai_venv/bin/python tools/check_log_privacy.py"
Na Windows ten scenariusz zachowuje się inaczej: po wyjątku pętla uvicorna przestaje odbierać
kolejne połączenia (serwer „wisi"), a traceback nie trafia na wyjście — więc test na Windows
potrafi pokazać „brak wycieku" tam, gdzie na Linuksie wyciek JEST. Sprawdzone 2026-08-17 na
tym samym kodzie: Windows „nie", Linux „TAK".
"""
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

PORT = 8917
MARKER = "TAJNA-TRESC-TRANSKRYPTU-42"


def _serve() -> None:
    """Tryb podprocesu: realna aplikacja + trasa-pułapka."""
    import uvicorn
    from src.main import create_app
    from src.schemas import Segment

    app = create_app()

    @app.get("/__leak_probe", response_model=Segment)
    async def _probe():
        # `text` niezgodny z `str` → ResponseValidationError, a komunikat Pydantica niesie
        # ODRZUCONĄ WARTOŚĆ w polu `input`. Tą wartością jest treść transkryptu.
        return {"start": 0.0, "end": 1.0, "text": [MARKER], "speaker": None, "words": None}

    @app.get("/__boom_probe", response_model=None)
    async def _boom():
        # Zwykły, nieobsłużony wyjątek z treścią w komunikacie — druga droga do logu.
        raise RuntimeError(f"boom: {MARKER}")

    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")


def main() -> int:
    proc = subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve()), "--serve"],
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    try:
        # czekaj na start (bez sleepa „na oko": pukamy do /health)
        deadline = time.time() + 30
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=1) as r:
                    if r.status == 200:
                        break
            except Exception:
                if proc.poll() is not None:
                    print("serwer padl przy starcie")
                    return 1
                time.sleep(0.25)
        else:
            print("serwer nie wstal w 30 s")
            return 1

        def _read(fp) -> str:
            # Gdy wyjątek leci dalej do uvicorna, odpowiedź bywa bez treści i z zerwanym
            # połączeniem — brak ciała to nie błąd testu.
            try:
                return fp.read().decode(errors="replace")[:200]
            except Exception:
                return "<brak tresci / polaczenie zerwane>"

        statuses = {}
        for path in ("/__leak_probe", "/__boom_probe"):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=10) as r:
                    statuses[path] = (r.status, _read(r))
            except urllib.error.HTTPError as e:
                statuses[path] = (e.code, _read(e))
            except Exception as e:  # noqa: BLE001 — np. zerwane połączenie zamiast odpowiedzi
                statuses[path] = (0, f"<brak odpowiedzi: {type(e).__name__}>")

        time.sleep(1.0)  # daj uvicornowi dopisać ewentualny traceback
    finally:
        proc.terminate()
        try:
            out = proc.communicate(timeout=15)[0] or ""
        except subprocess.TimeoutExpired:
            proc.kill()
            out = proc.communicate()[0] or ""

    failed = 0
    for path, (status, body) in statuses.items():
        ok = status == 500
        print(f"  {'OK ' if ok else 'BLAD'} {path} -> HTTP {status}")
        if not ok:
            failed += 1
        if MARKER in body:
            print(f"  BLAD {path}: marker wyciekl do ODPOWIEDZI HTTP: {body}")
            failed += 1

    leaks = [ln for ln in out.splitlines() if MARKER in ln]
    if leaks:
        failed += 1
        print(f"  BLAD marker w logach serwera ({len(leaks)} linii):")
        for ln in leaks[:5]:
            print("      " + ln.strip()[:200])
    else:
        print("  OK  marker nie pojawil sie w logach serwera")

    # log ma nadal cokolwiek raportowac — inaczej „brak wycieku" osiagamy ciszą
    if "unhandled_error" not in out:
        failed += 1
        print("  BLAD brak wpisu 'unhandled_error' — nie logujemy nawet faktu bledu")
    else:
        print("  OK  bled jest zalogowany (unhandled_error)")

    print(f"\n{'OK' if not failed else 'BLAD'} — problemow: {failed}")
    if failed:
        print("\n--- pelne wyjscie serwera ---")
        print(out[-4000:])
    return 1 if failed else 0


if __name__ == "__main__":
    if "--serve" in sys.argv:
        _serve()
    else:
        sys.exit(main())
