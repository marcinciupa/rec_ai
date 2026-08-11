"""Modele Pydantic dla kontraktu API (to, co widzi aplikacja mobilna)."""
from pydantic import BaseModel, Field


class Word(BaseModel):
    """Pojedyncze słowo z czasem — tylko silnik `advanced` z ts_level=word. Pozwala aplikacji
    podświetlać transkrypt CO DO SŁOWA zamiast dzielić tekst proporcjonalnie po znakach.
    `score` z deAPI świadomie pomijamy — apka go nie używa, a leci na urządzenie i do SQLite."""
    word: str
    start: float | None = None
    end: float | None = None
    speaker: str | None = None


class Segment(BaseModel):
    start: float | None = None
    end: float | None = None
    text: str
    speaker: str | None = None  # np. "SPEAKER_00" (tylko advanced + diarize); apka mapuje na 1, 2, 3…
    words: list[Word] | None = None


class TranscriptionResponse(BaseModel):
    job_id: str
    status: str  # completed | processing | failed
    recording_id: str | None = None
    transcript: str | None = None
    segments: list[Segment] | None = None
    language: str | None = None
    # Którym silnikiem policzone — apka zapisuje to przy notatce, żeby wiedzieć, czy ma dane
    # rozmówców (kolumna numerków w widoku transkrypcji) i czy karaoke może iść po słowach.
    engine: str | None = None


class ChatMessage(BaseModel):
    role: str  # user | assistant
    content: str = Field(max_length=8000)


class ChatRequest(BaseModel):
    # limity = ochrona przed nadmuchanym promptem do OpenRouter (koszt + pamięć)
    transcript: str = Field(max_length=100_000)
    messages: list[ChatMessage] = Field(default=[], max_length=50)
    question: str = Field(max_length=4000)
    model: str | None = None
    language: str | None = None  # kod języka odpowiedzi AI (np. "en", "pl"); brak → English


class ChatResponse(BaseModel):
    answer: str
    model: str
    usage: dict | None = None
