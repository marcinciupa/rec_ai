"""Ustawienia backendu (pydantic-settings). Wszystkie pola opcjonalne z sensownymi
domyślnymi → aplikacja wstaje bez kluczy (realne wywołania zwrócą wtedy 502/jasny błąd).
Klucze i sekrety trzymamy w .env (gitignored)."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: str = "development"
    log_level: str = "INFO"
    api_cors_origins: str = "*"
    max_upload_mb: int = 20  # deAPI: audio ≤ 20 MB

    # Publiczny URL TEGO backendu — z niego budujemy adres webhooka deAPI.
    # Lokalnie potrzebny tunel (cloudflared/ngrok), żeby deAPI mogło nas dosięgnąć.
    api_public_url: str | None = None

    # ── deAPI (transkrypcja; sterowane webhookiem, BEZ pollingu) ──
    deapi_api_key: str | None = None
    deapi_base_url: str = "https://api.deapi.ai"
    # Zweryfikowane żywym kluczem: pliki audio idą multipartem na v2 (aud2txt/v1 to URL-e social).
    # Akceptowane typy: audio/aac, audio/x-hx-aac-adts, audio/mpeg, audio/mp4, audio/x-m4a, audio/ogg,
    # audio/wav, audio/webm, audio/flac, video/webm. Apka nagrywa .aac (audio/aac) — OK.
    deapi_transcribe_path: str = "/api/v2/audio/transcriptions"
    deapi_model: str = "WhisperLargeV3"
    deapi_timeout_s: float = 30.0  # timeout requestu submit
    deapi_result_wait_s: float = 120.0  # ile request API czeka na webhook (bez pollingu)
    waiter_result_ttl_s: int = 900  # jak długo trzymać wynik webhooka (idempotencja + spóźniony webhook)
    deapi_webhook_path: str = "/api/v1/webhooks/deapi"
    deapi_webhook_url_override: str | None = None  # np. URL webhook.site do podejrzenia payloadu
    deapi_webhook_secret: str | None = None
    deapi_webhook_tolerance_s: int = 300  # ± okno dla X-DeAPI-Timestamp

    # ── OpenRouter (czat) ──
    openrouter_api_key: str | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    llm_chat_model: str = "google/gemini-2.5-flash-lite"  # tani + wielojęzyczny; wystarcza do Q&A o notatce
    openrouter_referer: str = "https://rec.ai"
    openrouter_title: str = "REC_AI"
    llm_timeout_s: float = 60.0

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.api_cors_origins.split(",") if o.strip()]

    @property
    def webhook_url(self) -> str | None:
        """Adres, który podajemy deAPI jako webhook_url. Override (np. webhook.site) ma
        pierwszeństwo; inaczej budujemy z api_public_url + ścieżka webhooka."""
        if self.deapi_webhook_url_override:
            return self.deapi_webhook_url_override
        if self.api_public_url:
            return self.api_public_url.rstrip("/") + self.deapi_webhook_path
        return None


@lru_cache
def get_settings() -> Settings:
    return Settings()
