from fastapi import APIRouter, Request

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(request: Request) -> dict:
    s = request.app.state.settings
    return {
        "status": "ok",
        "environment": s.environment,
        "deapi_configured": bool(s.deapi_api_key),
        "openrouter_configured": bool(s.openrouter_api_key),
        "webhook_url": s.webhook_url,
        "webhook_secret_set": bool(s.deapi_webhook_secret),
    }
