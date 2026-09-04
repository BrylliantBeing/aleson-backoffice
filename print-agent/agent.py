"""Aleson back-office print agent.

Runs on the ticketing counter's Windows PC and gives the browser the one thing
it cannot do itself: hand raw bytes to a printer. The back office renders the
passage ticket as ESC/P (see src/utils/escp.ts), POSTs it here, and this hands
it to the Windows spooler with the RAW datatype so the LX-310 receives exactly
those bytes -- no driver re-rendering, no graphics mode, no print dialog.

All ticket layout lives in the web app, so alignment changes are a redeploy of
the back office, not a visit to every counter. This agent should almost never
need to change.

Run:  python agent.py
      (or run-agent.bat, which also creates the virtualenv on first use)

Config, all optional, via environment variables or a config.json beside this
file:
    PRINT_AGENT_HOST            default 127.0.0.1 -- do not expose this
    PRINT_AGENT_PORT            default 9101
    PRINT_AGENT_PRINTER         default Windows printer name, else the system default
    PRINT_AGENT_ALLOWED_ORIGINS comma-separated; the back office's URL(s)
"""

from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

try:
    import win32print  # type: ignore
except ImportError:  # pragma: no cover - the agent only ships to Windows counters
    win32print = None

VERSION = "1.0.0"
CONFIG_PATH = Path(__file__).with_name("config.json")

# Ticket stock is pre-numbered and accounted for, so a stray print is not free.
# Only the back office may drive this agent; anything else is refused by CORS.
DEFAULT_ORIGINS = [
    "http://localhost:8081",  # expo start --web
    "http://127.0.0.1:8081",
    "http://localhost:8080",  # the nginx image, run locally
]


def _config() -> dict:
    data: dict = {}
    if CONFIG_PATH.exists():
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            print(f"[config] ignoring {CONFIG_PATH.name}: {e}", file=sys.stderr)
    return data


CONFIG = _config()


def _setting(env: str, key: str, default):
    return os.getenv(env) or CONFIG.get(key) or default


HOST = _setting("PRINT_AGENT_HOST", "host", "127.0.0.1")
PORT = int(_setting("PRINT_AGENT_PORT", "port", 9101))
DEFAULT_PRINTER = _setting("PRINT_AGENT_PRINTER", "printer", "") or None

_origins = _setting("PRINT_AGENT_ALLOWED_ORIGINS", "allowed_origins", "")
if isinstance(_origins, str):
    _origins = [o.strip() for o in _origins.split(",") if o.strip()]
ALLOWED_ORIGINS = list(dict.fromkeys([*DEFAULT_ORIGINS, *_origins]))

app = FastAPI(title="Aleson Print Agent", version=VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def allow_private_network(request: Request, call_next):
    """Answer Chrome's Private Network Access preflight.

    A page on a public HTTPS origin reaching a loopback address triggers an
    extra preflight carrying Access-Control-Request-Private-Network; without
    the matching response header the browser blocks the request even though
    plain CORS would have allowed it.
    """
    if request.method == "OPTIONS" and request.headers.get(
        "access-control-request-private-network"
    ):
        origin = request.headers.get("origin", "")
        if origin in ALLOWED_ORIGINS:
            return Response(
                status_code=204,
                headers={
                    "Access-Control-Allow-Origin": origin,
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type",
                    "Access-Control-Allow-Private-Network": "true",
                    "Access-Control-Max-Age": "600",
                },
            )
    return await call_next(request)


def _require_win32print():
    if win32print is None:
        raise HTTPException(
            status_code=500,
            detail="pywin32 is not installed. Run: pip install -r requirements.txt",
        )


def _printers() -> list[str]:
    if win32print is None:
        return []
    flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
    return [p[2] for p in win32print.EnumPrinters(flags)]


def _resolve_printer(requested: str | None) -> str:
    _require_win32print()
    name = (requested or DEFAULT_PRINTER or "").strip()
    if not name:
        name = win32print.GetDefaultPrinter()
    if not name:
        raise HTTPException(status_code=400, detail="No printer selected and no Windows default is set.")
    available = _printers()
    if available and name not in available:
        raise HTTPException(
            status_code=404,
            detail=f"Printer '{name}' not found. Available: {', '.join(available)}",
        )
    return name


@app.get("/healthz")
def healthz():
    default = None
    if win32print is not None:
        try:
            default = win32print.GetDefaultPrinter()
        except Exception:
            default = None
    return {
        "ok": True,
        "version": VERSION,
        "platform": sys.platform,
        "win32print": win32print is not None,
        "default_printer": DEFAULT_PRINTER or default,
        "printers": _printers(),
    }


@app.get("/printers")
def printers():
    _require_win32print()
    return {"printers": _printers(), "default": win32print.GetDefaultPrinter()}


class PrintRequest(BaseModel):
    data_base64: str
    printer: str | None = None
    job_name: str = "Aleson passage ticket"


# One sale is a handful of small forms; anything larger is a bug or an abuse,
# and a runaway job on continuous stock wastes numbered tickets.
MAX_JOB_BYTES = 512 * 1024


@app.post("/print")
def print_raw(req: PrintRequest, request: Request):
    # CORS alone does not protect this endpoint. It governs whether a page may
    # READ the response, not whether the request is SENT -- a cross-origin POST
    # that qualifies as a "simple request" reaches the handler and prints,
    # whatever the browser then does with the reply. Any page open on the
    # counter PC could therefore drive the printer through loopback and burn
    # accountable, pre-numbered ticket stock.
    #
    # Requiring application/json is what closes it: that content type is not
    # simple, so the browser must preflight, and the preflight is where the
    # origin allowlist above actually gets to say no. The back office already
    # sends this header (fetch with a JSON body does so automatically), so this
    # costs the real client nothing.
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type != "application/json":
        raise HTTPException(
            status_code=415,
            detail="Content-Type must be application/json.",
        )
    # Defence in depth behind the preflight: a request that carries an Origin at
    # all came from a browser, and if it did, that origin must be one we allow.
    # Requests with no Origin are the agent's own local tooling (curl, the
    # /healthz probe), which no web page can forge an omission for.
    origin = request.headers.get("origin")
    if origin is not None and origin not in ALLOWED_ORIGINS:
        raise HTTPException(status_code=403, detail=f"Origin {origin} is not allowed to print.")

    try:
        payload = base64.b64decode(req.data_base64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="data_base64 is not valid base64.")
    if not payload:
        raise HTTPException(status_code=400, detail="Nothing to print.")
    if len(payload) > MAX_JOB_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Job is {len(payload)} bytes; the limit is {MAX_JOB_BYTES}.",
        )

    name = _resolve_printer(req.printer)
    # Job names show up in the Windows queue, so keep them short and inert.
    job_name = (req.job_name or "Aleson passage ticket")[:80]

    handle = win32print.OpenPrinter(name)
    try:
        # datatype RAW: the spooler passes the bytes through untouched, which is
        # the whole point -- ESC/P positioning must survive to the printer.
        job = win32print.StartDocPrinter(handle, 1, (job_name, None, "RAW"))
        try:
            win32print.StartPagePrinter(handle)
            written = win32print.WritePrinter(handle, payload)
            win32print.EndPagePrinter(handle)
        finally:
            win32print.EndDocPrinter(handle)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Printing failed: {e}")
    finally:
        win32print.ClosePrinter(handle)

    return {"ok": True, "printer": name, "job_id": job, "bytes": written}


if __name__ == "__main__":
    import uvicorn

    print(f"Aleson print agent {VERSION} on http://{HOST}:{PORT}")
    print(f"Allowed origins: {', '.join(ALLOWED_ORIGINS)}")
    if win32print is None:
        print("WARNING: pywin32 missing -- /print will fail.", file=sys.stderr)
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
