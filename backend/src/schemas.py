"""Modele Pydantic dla kontraktu API (to, co widzi aplikacja mobilna)."""
from pydantic import BaseModel


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
    content: str


class ChatRequest(BaseModel):
    transcript: str
    messages: list[ChatMessage] = []
    question: str
    model: str | None = None


class ChatResponse(BaseModel):
    answer: str
    model: str
    usage: dict | None = None
