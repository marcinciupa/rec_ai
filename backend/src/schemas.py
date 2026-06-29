"""Modele Pydantic dla kontraktu API (to, co widzi aplikacja mobilna)."""
from pydantic import BaseModel, Field


class Segment(BaseModel):
    start: float | None = None
    end: float | None = None
    text: str


class TranscriptionResponse(BaseModel):
    job_id: str
    status: str  # completed | processing | failed
    recording_id: str | None = None
    transcript: str | None = None
    segments: list[Segment] | None = None
    language: str | None = None


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
