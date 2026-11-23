"""Private loopback server started and stopped by the Electron main process."""

import ctypes
import json
import logging
import os
import secrets
import sys
import threading

import uvicorn
from fastapi import Request
from fastapi.responses import JSONResponse

from server.builder import build_manager
from server.main import HOST, create_app
from server.staticserve import has_dist


class DesktopServer(uvicorn.Server):
    async def startup(self, sockets=None):
        stopped = threading.Event()

        def report_startup():
            while not stopped.is_set():
                print(json.dumps({"event": "startup-progress", "stage": "preparing-data"}), flush=True)
                stopped.wait(5)

        reporter = threading.Thread(target=report_startup, daemon=True)
        reporter.start()
        try:
            await super().startup(sockets)
        finally:
            stopped.set()
            reporter.join()
        if self.started:
            port = self.servers[0].sockets[0].getsockname()[1]
            print(json.dumps({"port": port}), flush=True)


def run() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    token = os.environ.pop("PACK_TOOL_DESKTOP_TOKEN")
    if not has_dist():
        raise RuntimeError("Frontend assets are missing")

    app = create_app(allow_dev_proxy=False)

    @app.middleware("http")
    async def authenticate(request: Request, call_next):
        supplied_token = request.headers.get("X-Pack-Tool-Token", "")
        if not secrets.compare_digest(supplied_token.encode(), token.encode()):
            return JSONResponse({"detail": "Forbidden"}, status_code=403)
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'; "
            "base-uri 'none'; form-action 'none'"
        )
        return response

    config = uvicorn.Config(
        app, host=HOST, port=0, log_config=None, access_log=False,
        loop="asyncio", http="h11", ws="none",
        lifespan="on", timeout_graceful_shutdown=5,
    )
    server = DesktopServer(config)

    def shutdown_on_eof() -> None:
        sys.stdin.buffer.read()
        server.should_exit = True

    if getattr(sys, "frozen", False) and os.name == "nt":
        # Use system DLLs when invoking PowerShell, HBuilderX, Gradle or adb.
        ctypes.windll.kernel32.SetDllDirectoryW(None)
    threading.Thread(target=shutdown_on_eof, daemon=True).start()
    try:
        server.run()
    finally:
        build_manager.stop_and_wait(timeout=5)


if __name__ == "__main__":
    run()
