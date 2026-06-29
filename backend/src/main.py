"""REC_AI API — bezstanowy proxy: deAPI (transkrypcja, webhook) + OpenRouter (czat).
Trzyma klucze po stronie serwera, nie przechowuje treści, loguje tylko metadane."""
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

import structlog
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import get_settings
from .deps import RateLimiter
from .logging_context import configure_logging
from .routers import chat, health, transcriptions, webhooks
from .services.deapi import DeApiClient
from .services.openrouter import OpenRouterClient
from .waiters import WebhookWaiters


async def _sweep_waiters(waiters: WebhookWaiters, limiter: RateLimiter, ttl_s: int) -> None:
    """Okresowo usuwa stare wyniki webhooków i wygasłe wpisy rate-limitera (ogranicza pamięć)."""
    while True:
        await asyncio.sleep(max(60, ttl_s // 2))
        try:  # guard — wyjątek w sweepie nie może ubić pętli (inaczej pamięć rośnie bez końca)
            dropped = waiters.sweep()
            limiter.sweep()
            if dropped:
                structlog.get_logger().info("waiter_sweep", dropped=dropped)
        except Exception as e:  # noqa: BLE001
            structlog.get_logger().warning("sweep_error", error=str(e))


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level)
    app.state.settings = settings
    app.state.deapi = DeApiClient(settings)
    app.state.openrouter = OpenRouterClient(settings)
    app.state.waiters = WebhookWaiters(result_ttl_s=settings.waiter_result_ttl_s)
    app.state.rate_limiter = RateLimiter(settings.rate_limit_per_min)
    sweeper = asyncio.create_task(
        _sweep_waiters(app.state.waiters, app.state.rate_limiter, settings.waiter_result_ttl_s)
    )
    structlog.get_logger().info(
        "startup", environment=settings.environment, webhook_url=settings.webhook_url
    )
    yield
    sweeper.cancel()
    await app.state.deapi.aclose()
    await app.state.openrouter.aclose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="REC_AI API", version="0.1.0", lifespan=lifespan)
    # CORS fail-closed: w produkcji NIE pozwalamy na „*" (otwarte proxy dla dowolnej strony www).
    # Apka mobilna jest natywna (nie używa CORS) → pusta lista jej nie psuje; chroni tylko przed www.
    origins = settings.cors_origins
    if settings.environment == "production" and origins == ["*"]:
        structlog.get_logger().error("cors_wildcard_in_production_blocked")
        origins = []
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Passthrough HTTPException PRZED catch-all (inaczej globalny handler zamaskowałby je jako 500).
    @app.exception_handler(StarletteHTTPException)
    async def _http_exc(request, exc: StarletteHTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}, headers=exc.headers)

    # RequestValidationError NIE jest HTTPException → bez tego catch-all zwracałby 500 zamiast 422.
    @app.exception_handler(RequestValidationError)
    async def _validation_exc(request, exc: RequestValidationError):
        # NIE odbijaj wejścia z powrotem (Pydantic v2 wkłada `input`/`ctx` do errors → mogłoby
        # zwrócić treść transkryptu/pytania). Zostaw tylko typ/lokalizację/komunikat.
        safe = [{"type": e.get("type"), "loc": e.get("loc"), "msg": e.get("msg")} for e in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": safe})

    @app.exception_handler(Exception)
    async def _unhandled(request, exc: Exception):
        structlog.get_logger().error("unhandled_error", error=str(exc))
        return JSONResponse(status_code=500, content={"detail": "internal server error"})

    app.include_router(health.router)
    app.include_router(transcriptions.router, prefix="/api/v1")
    app.include_router(chat.router, prefix="/api/v1")
    app.include_router(webhooks.router, prefix="/api/v1")

    # Statyczna polityka prywatności (URL do Google Play / App Store).
    @app.get("/privacy", include_in_schema=False)
    async def privacy():
        return FileResponse(Path(__file__).parent / "privacy.html", media_type="text/html")

    return app


app = create_app()
