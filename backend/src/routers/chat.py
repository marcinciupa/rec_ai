"""POST /api/v1/chat — czat o pojedynczej notatce (OpenRouter)."""
from fastapi import APIRouter, Depends, HTTPException, Request

from ..deps import require_device_id
from ..schemas import ChatRequest, ChatResponse
from ..services.openrouter import OpenRouterError

router = APIRouter(tags=["chat"])


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: Request,
    body: ChatRequest,
    device_id: str = Depends(require_device_id),
) -> ChatResponse:
    client = request.app.state.openrouter
    try:
        answer, model, usage = await client.chat(
            transcript=body.transcript,
            history=[m.model_dump() for m in body.messages],
            question=body.question,
            model=body.model,
        )
    except OpenRouterError as e:
        raise HTTPException(status_code=502, detail=f"chat failed: {e}")
    return ChatResponse(answer=answer, model=model, usage=usage)
