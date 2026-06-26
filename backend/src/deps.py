"""Wspólne zależności FastAPI."""
from fastapi import Header, HTTPException


async def require_device_id(x_device_id: str | None = Header(default=None)) -> str:
    """Anonimowy identyfikator urządzenia — wymagany na endpointach trzymających płatne klucze."""
    if not x_device_id:
        raise HTTPException(status_code=401, detail="X-Device-Id header required")
    return x_device_id
