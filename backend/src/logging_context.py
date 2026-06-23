"""Konfiguracja structlog. Logujemy WYŁĄCZNIE metadane (device_id, request_id, status,
rozmiary, czasy) — NIGDY treści audio/transkryptu/czatu (gwarancja prywatności, STACK.md §16)."""
import logging

import structlog


def configure_logging(level: str = "INFO") -> None:
    lvl = getattr(logging, level.upper(), logging.INFO)
    logging.basicConfig(format="%(message)s", level=lvl)
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(lvl),
        cache_logger_on_first_use=True,
    )
