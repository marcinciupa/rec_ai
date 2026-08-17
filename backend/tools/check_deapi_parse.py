"""Testy parsera odpowiedzi deAPI (src/services/deapi.py). Bez runnera — jak testy w mobile/tools.

Uruchomienie (z katalogu backend/):
    python tools/check_deapi_parse.py

(Nazwa `check_*`, nie `test_*`: plik wola `sys.exit()` na poziomie modulu, wiec gdyby ktos
dolozyl pytest, domyslne zbieranie `test_*.py` wywalaloby sie juz przy imporcie.)

Powód istnienia: czasy z deAPI lądują w schemacie odpowiedzi jako `float | None`. Wartość spoza
kontraktu (np. "00:00:01") wywracała się dopiero na WALIDACJI ODPOWIEDZI, a komunikat
ResponseValidationError niesie `input` — czyli fragment transkryptu — i przez globalny handler
trafiał do logów. Polityka prywatności obiecuje logi bez treści, więc czasy tniemy przy parsowaniu.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.schemas import Segment, TranscriptionResponse  # noqa: E402
from src.services.deapi import _as_float, _as_str, parse_transcript_payload  # noqa: E402

passed = failed = 0


def eq(name, got, want):
    """Porownanie TYPOCZULE — samo `==` przepuszcza `1 == 1.0`, wiec test na rzutowanie
    int->float przechodzilby bez rzutowania."""
    global passed, failed
    same = (type(got) is type(want)) and got == want if want is not None else got is None
    if same:
        passed += 1
    else:
        failed += 1
        print(f"  x {name}\n      dostalem:   {got!r} ({type(got).__name__})\n      oczekiwane: {want!r} ({type(want).__name__})")


def eq_loose(name, got, want):
    """Dla struktur (dict/list), gdzie typoczulosc na najwyzszym poziomie nic nie wnosi."""
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
eq_loose("happy: slowo", seg["words"][0], {"word": "hi", "start": 0.5, "end": 1.5, "speaker": None})
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
eq_loose("schemat przyjmuje wynik parsera", (validated.start, validated.end), (None, 2.0))

# ── wariant `timestamp: [start, end]` (starsze odpowiedzi) ────────────────────
ts = parse_transcript_payload({"segments": [{"timestamp": [1, 2], "text": "x"}]})["segments"][0]
eq("timestamp -> start", ts["start"], 1.0)
eq("timestamp -> end", ts["end"], 2.0)
ts_bad = parse_transcript_payload({"segments": [{"timestamp": ["a", "b"], "text": "x"}]})["segments"][0]
eq_loose("brudny timestamp -> None", (ts_bad["start"], ts_bad["end"]), (None, None))

# ── ksztalty spoza kontraktu nie moga rzucac ─────────────────────────────────
eq("payload nie-dict", parse_transcript_payload("boom")["transcript"], "boom")
eq("brak segmentow", parse_transcript_payload({"transcript": "t"})["segments"], None)
eq("segmenty nie-dict sa pomijane", parse_transcript_payload({"segments": ["x", {"text": "y"}]})["segments"][0]["text"], "y")
eq("words nie-lista -> None", parse_transcript_payload({"segments": [{"text": "y", "words": "nope"}]})["segments"][0]["words"], None)

# ── inf / nan: pydantic je PRZEPUSZCZA, ale JSONResponse renderuje z allow_nan=False ─────────
# (czyli 500 dopiero na serializacji i utrata calego transkryptu; `json.loads('{"a": NaN}')` dziala)
eq("string 'inf' -> None", _as_float("inf"), None)
eq("string 'nan' -> None", _as_float("nan"), None)
eq("string 'Infinity' -> None", _as_float("Infinity"), None)
eq("przepelnienie '1e400' -> None", _as_float("1e400"), None)
eq("float('inf') -> None", _as_float(float("inf")), None)
eq("float('nan') -> None", _as_float(float("nan")), None)

# ── KOLEJNOSC: brudny `start` NIE moze zjadac dobrego `timestamp` ───────────────────────────
mix = parse_transcript_payload(
    {"segments": [{"start": "00:00:01", "end": "00:00:05", "timestamp": [1, 5], "text": "x"}]}
)["segments"][0]
eq("brudny start + dobry timestamp -> start", mix["start"], 1.0)
eq("brudny start + dobry timestamp -> end", mix["end"], 5.0)
zero = parse_transcript_payload({"segments": [{"start": 0, "timestamp": [9, 9], "text": "x"}]})["segments"][0]
eq("start=0 NIE jest traktowany jak brak", zero["start"], 0.0)

# ── pola tekstowe: wartosc spoza kontraktu nie moze dojsc do walidacji ODPOWIEDZI ────────────
# Komunikat ResponseValidationError niesie odrzucona wartosc w polu `input` — czyli TRESC.
SECRET = "TRESC-KTORA-NIE-MOZE-TRAFIC-DO-LOGU"
dirty = parse_transcript_payload(
    {
        "transcript": {"full": SECRET},
        "language": ["en"],
        "segments": [
            {
                "start": 0.0,
                "end": 1.0,
                "text": [SECRET],
                "speaker": {"name": SECRET},
                "words": [{"word": [SECRET], "start": 0.0}, {"word": "ok", "speaker": 7}],
            }
        ],
    }
)
dseg = dirty["segments"][0]
eq("transcript nie-str -> None", dirty["transcript"], None)
eq("language nie-str -> None", dirty["language"], None)
eq("text nie-str -> pusty string", dseg["text"], "")
eq("speaker nie-str -> None", dseg["speaker"], None)
eq_loose("slowo nie-str pominiete, reszta zostaje", [w["word"] for w in dseg["words"]], ["ok"])
eq("speaker slowa nie-str -> None", dseg["words"][0]["speaker"], None)
# Schemat MUSI przyjac wynik parsera — inaczej wyjatek walidacji wynosi tresc do logow.
_seg_model = Segment(**dseg)
TranscriptionResponse(
    job_id="j",
    status="completed",
    recording_id="r",
    engine="advanced",
    transcript=dirty["transcript"],
    segments=[_seg_model],
    language=dirty["language"],
)
passed += 1  # samo przejscie powyzszych konstruktorow bez wyjatku jest asercja

eq("_as_str przepuszcza string", _as_str("abc"), "abc")
eq("_as_str na liczbie -> None", _as_str(5), None)

print(f"\n{'OK' if not failed else 'BLAD'} zdane {passed}, oblane {failed}")
sys.exit(1 if failed else 0)
