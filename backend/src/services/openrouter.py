"""Klient OpenRouter — czat o jednej notatce. Kontrakt OpenAI-compatible, JSON (bez streamu w v1)."""
import json

import httpx


class OpenRouterError(Exception):
    pass


class OpenRouterClient:
    def __init__(self, settings):
        self.s = settings
        self._client = httpx.AsyncClient(
            base_url=settings.openrouter_base_url, timeout=httpx.Timeout(settings.llm_timeout_s)
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def chat(self, *, transcript: str, history: list[dict], question: str, model: str | None = None):
        if not self.s.openrouter_api_key:
            raise OpenRouterError("OPENROUTER_API_KEY not configured")
        model = model or self.s.llm_chat_model
        system = (
            "You are REC_AI, an assistant that helps the user talk about ONE of their voice notes. "
            "Answer in the same language as the user's question. Be concise and concrete. "
            "Ground every answer ONLY in the transcript below; if the answer isn't in it, say so.\n\n"
            "TRANSCRIPT:\n" + (transcript or "(empty)")
        )
        messages: list[dict] = [{"role": "system", "content": system}]
        for m in (history or [])[-12:]:  # cap historii: ostatnie 12 tur verbatim
            role, content = m.get("role"), m.get("content")
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": question})

        headers = {
            "Authorization": f"Bearer {self.s.openrouter_api_key}",
            "HTTP-Referer": self.s.openrouter_referer,
            "X-Title": self.s.openrouter_title,
        }
        payload = {"model": model, "messages": messages}
        try:
            r = await self._client.post("/chat/completions", headers=headers, json=payload)
        except httpx.HTTPError as e:
            raise OpenRouterError(f"request failed: {e}")
        if r.status_code >= 400:
            raise OpenRouterError(f"{r.status_code}: {r.text[:300]}")
        data = json.loads(r.content)  # bytes→UTF-8 (nie zgadujemy charsetu jak httpx .json()/.text)
        try:
            answer = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            raise OpenRouterError(f"unexpected response: {str(data)[:200]}")
        return answer, data.get("model", model), data.get("usage")
