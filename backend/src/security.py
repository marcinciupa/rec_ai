"""Weryfikacja podpisu HMAC webhooka deAPI.

Per STACK.md §18: nagłówek X-DeAPI-Signature = "sha256=<hex>", gdzie
<hex> = HMAC-SHA256(secret, f"{timestamp}.{raw_body}"), oraz X-DeAPI-Timestamp w oknie ±tolerance.
Dokładny schemat NIEZWERYFIKOWANY z żywym deAPI — potwierdzić realnym webhookiem i zablokować."""
import hashlib
import hmac
import time


def verify_deapi_signature(
    *,
    secret: str | None,
    raw_body: bytes,
    signature_header: str | None,
    timestamp_header: str | None,
    tolerance_s: int = 300,
) -> tuple[bool, str | None]:
    if not secret:
        return False, "webhook secret not configured"
    if not signature_header or not timestamp_header:
        return False, "missing signature or timestamp header"
    try:
        ts = int(timestamp_header)
    except (TypeError, ValueError):
        return False, "invalid timestamp"
    if abs(time.time() - ts) > tolerance_s:
        return False, "timestamp outside tolerance window"
    # hex jest case-insensitive → normalizujemy do małych liter (inaczej deAPI z wielkimi literami = cichy outage)
    provided = signature_header.split("=", 1)[-1].strip().lower()
    # Podpisujemy surowe bajty body (bez ponownego kodowania, które mogłoby zmienić zawartość).
    signed_payload = timestamp_header.encode() + b"." + raw_body
    expected = hmac.new(secret.encode(), signed_payload, hashlib.sha256).hexdigest()  # już lowercase
    try:
        # porównanie na bajtach ASCII; nie-ASCII w nagłówku = po prostu brak dopasowania (bez wyjątku)
        provided_b = provided.encode("ascii")
    except UnicodeEncodeError:
        return False, "signature mismatch"
    if not hmac.compare_digest(expected.encode("ascii"), provided_b):
        return False, "signature mismatch"
    return True, None
