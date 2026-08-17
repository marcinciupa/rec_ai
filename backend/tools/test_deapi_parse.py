"""Testy parsera odpowiedzi deAPI (src/services/deapi.py). Bez runnera — jak testy w mobile/tools.

Uruchomienie (z katalogu backend/):
    python tools/test_deapi_parse.py

Powód istnienia: czasy z deAPI lądują w schemacie odpowiedzi jako `float | None`. Wartość spoza
kontraktu (np. "00:00:01") wywracała się dopiero na WALIDACJI ODPOWIEDZI, a komunikat
ResponseValidationError niesie `input` — czyli fragment transkryptu — i przez globalny handler
trafiał do logów. Polityka prywatności obiecuje logi bez treści, więc czasy tniemy przy parsowaniu.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.schemas import Segment  # noqa: E402
from src.services.deapi import _as_float, parse_transcript_payload  # noqa: E402

passed = failed = 0


def eq(name, got, want):
    global passed, failed
    if got == want:
        passed += 1
    else:
        failed += 1
        print(f"  x {name}\n      dostalem:   {got!r}\n      oczekiwane: {want!r}")


# ── _as_float ──────────────────────────────────────────────────────────────────
eq("int -> float", _as_float(1), 1.0)
eq("float zostaje", _as_float(2.5), 2.5)
eq("string liczbowy", _as_float("2.5"), 2.5)
eq("string z bialymi znakami", _as_float(" 3 "), 3.0)
eq("timecode -> None", _as_float("00:00:01"), None)
eq("None -> None", _as_float(None), None)
eq("bool NIE jest liczba", _as_float(True), None)
eq("dict -> None", _as_float({}), None)
eq("lista -> None", _as_float([1]), None)
eq("zero przechodzi (nie myl z falsy)", _as_float(0), 0.0)

# ── segmenty: happy path nie moze sie zmienic ─────────────────────────────────
ok = parse_transcript_payload(
    {
        "transcript": "hi",
        "language": "en",
        "segments": [
            {"start": 0.5, "end": 1.5, "text": "hi", "speaker": "SPEAKER_01", "words": [{"word": "hi", "start": 0.5, "end": 1.5}]}
        ],
    }
)
seg = ok["segments"][0]
eq("happy: start", seg["start"], 0.5)
eq("happy: end", seg["end"], 1.5)
eq("happy: speaker", seg["speaker"], "SPEAKER_01")
eq("happy: slowo", seg["words"][0], {"word": "hi", "start": 0.5, "end": 1.5, "speaker": None})
eq("happy: transcript", ok["transcript"], "hi")
eq("happy: language", ok["language"], "en")

# ── segmenty: smiec w czasach nie wywala walidacji i NIE gubi tekstu ──────────
bad = parse_transcript_payload(
    {
        "transcript": "t",
        "segments": [
            {
                "start": "00:00:01",
                "end": 2,
                "text": "tresc notatki",
                "speaker": "SPEAKER_00",
                "words": [{"word": "a", "start": "x", "end": 1.0}],
            }
        ],
    }
)
bseg = bad["segments"][0]
eq("brudny start -> None", bseg["start"], None)
eq("poprawny end przechodzi", bseg["end"], 2.0)
eq("tekst segmentu nietkniety", bseg["text"], "tresc notatki")
eq("brudny czas slowa -> None", bseg["words"][0]["start"], None)

validated = Segment(**bseg)  # to rzucalo ResponseValidationError przed poprawka
eq("schemat przyjmuje wynik parsera", (validated.start, validated.end), (None, 2.0))

# ── wariant `timestamp: [start, end]` (starsze odpowiedzi) ────────────────────
ts = parse_transcript_payload({"segments": [{"timestamp": [1, 2], "text": "x"}]})["segments"][0]
eq("timestamp -> start", ts["start"], 1.0)
eq("timestamp -> end", ts["end"], 2.0)
ts_bad = parse_transcript_payload({"segments": [{"timestamp": ["a", "b"], "text": "x"}]})["segments"][0]
eq("brudny timestamp -> None", (ts_bad["start"], ts_bad["end"]), (None, None))

# ── ksztalty spoza kontraktu nie moga rzucac ─────────────────────────────────
eq("payload nie-dict", parse_transcript_payload("boom")["transcript"], "boom")
eq("brak segmentow", parse_transcript_payload({"transcript": "t"})["segments"], None)
eq("segmenty nie-dict sa pomijane", parse_transcript_payload({"segments": ["x", {"text": "y"}]})["segments"][0]["text"], "y")
eq("words nie-lista -> None", parse_transcript_payload({"segments": [{"text": "y", "words": "nope"}]})["segments"][0]["words"], None)

print(f"\n{'OK' if not failed else 'BLAD'} zdane {passed}, oblane {failed}")
sys.exit(1 if failed else 0)
