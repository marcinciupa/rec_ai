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
from .logging_context import configure_logging
from .routers import chat, health, transcriptions, webhooks
from .services.deapi import DeApiClient
from .services.openrouter import OpenRouterClient
from .waiters import WebhookWaiters


async def _sweep_waiters(waiters: WebhookWaiters, ttl_s: int) -> None:
    """Okresowo usuwa stare wyniki webhooków (ogranicza pamięć)."""
    while True:
        await asyncio.sleep(max(60, ttl_s // 2))
        dropped = waiters.sweep()
        if dropped:
            structlog.get_logger().info("waiter_sweep", dropped=dropped)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level)
    app.state.settings = settings
    app.state.deapi = DeApiClient(settings)
    app.state.openrouter = OpenRouterClient(settings)
    app.state.waiters = WebhookWaiters(result_ttl_s=settings.waiter_result_ttl_s)
    sweeper = asyncio.create_task(_sweep_waiters(app.state.waiters, settings.waiter_result_ttl_s))
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
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
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
        return JSONResponse(status_code=422, content={"detail": exc.errors()})

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
