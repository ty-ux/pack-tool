import asyncio
import io
import json
import logging
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse

from server import diagnostics


class DiagnosticsTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / "workspace"
        self.logs = self.root / "logs"
        for name, value in (("DATA_ROOT", self.root), ("LOGS_DIR", self.logs),
                            ("OPERATION_LOG", self.logs / "application.log")):
            context = patch.object(diagnostics, name, value)
            context.start()
            self.addCleanup(context.stop)
        self.logger = diagnostics.configure_logging()
        self.addCleanup(self.close_logger)
        self.app = FastAPI()
        self.app.add_middleware(diagnostics.OperationLogMiddleware)

        @self.app.post("/api/config")
        async def save_config(request: Request):
            return {"ok": True, "config": await request.json()}

        @self.app.get("/api/signing-keys/reveal")
        async def reveal():
            return {"ok": True, "storePassword": "response-password-must-not-leak"}

        @self.app.post("/api/build")
        async def business_failure():
            return {"ok": False, "error": "dependency missing"}

        @self.app.get("/api/fatal")
        async def fatal():
            raise RuntimeError("storePassword=hidden-exception-password token=hidden-token")

        @self.app.get("/api/rejected")
        async def rejected():
            raise HTTPException(400, "safe rejection")

        @self.app.get("/api/logs")
        async def streamed():
            async def chunks():
                yield b"first\n"
                yield b"second\n"
            return StreamingResponse(chunks(), media_type="text/plain")

    def close_logger(self):
        for handler in self.logger.handlers[:]:
            if hasattr(handler, "_packtool_file"):
                self.logger.removeHandler(handler)
                handler.close()

    async def request(self, path, method="GET", body=None):
        messages = []
        sent = False
        disconnected = asyncio.Event()

        async def receive():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": json.dumps(body or {}).encode(), "more_body": False}
            await disconnected.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            messages.append(message)
            if message["type"] == "http.response.body" and not message.get("more_body", False):
                disconnected.set()

        scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"},
                 "http_version": "1.1", "method": method, "path": path,
                 "raw_path": path.encode(), "query_string": b"token=query-secret-do-not-log",
                 "root_path": "", "scheme": "http", "server": ("localhost", 80),
                 "client": ("127.0.0.1", 1234), "headers": [(b"content-type", b"application/json"),
                 (b"authorization", b"Bearer header-secret-do-not-log")]}
        await self.app(scope, receive, send)
        return messages

    def contents(self):
        return diagnostics.OPERATION_LOG.read_text(encoding="utf-8")

    async def test_every_operation_has_correlated_result_without_request_response_or_header_secrets(self):
        responses = [await self.request("/api/config", "POST", {"storePassword": "request-password-must-not-leak"}),
                     await self.request("/api/signing-keys/reveal"), await self.request("/api/rejected")]
        text = self.contents()
        for response in responses:
            start = next(item for item in response if item["type"] == "http.response.start")
            correlation = dict(start["headers"])[b"x-request-id"].decode()
            self.assertIn("request=" + correlation, text)
        self.assertIn("operation.end method=POST route=/api/config status=200 result=ok", text)
        self.assertIn("route=/api/rejected status=400 result=failed", text)
        for secret in ("request-password-must-not-leak", "response-password-must-not-leak",
                       "query-secret-do-not-log", "header-secret-do-not-log"):
            self.assertNotIn(secret, text)

    async def test_business_failure_at_http_200_is_logged_as_failure(self):
        await self.request("/api/build", "POST")
        self.assertIn("status=200 result=failed", self.contents())
        self.assertIn("dependency missing", self.contents())

    async def test_exception_has_traceback_and_redacts_credentials(self):
        response = await self.request("/api/fatal")
        start = next(item for item in response if item["type"] == "http.response.start")
        self.assertEqual(start["status"], 500)
        self.assertIn(b"x-request-id", dict(start["headers"]))
        text = self.contents()
        self.assertIn("Traceback", text)
        self.assertIn("operation.exception", text)
        self.assertNotIn("hidden-exception-password", text)
        self.assertNotIn("hidden-token", text)
        self.assertIn("[REDACTED]", text)
        self.assertEqual(diagnostics.request_id.get(), "-")

    async def test_streamed_body_is_unchanged(self):
        messages = await self.request("/api/logs")
        self.assertEqual(b"".join(item.get("body", b"") for item in messages), b"first\nsecond\n")

    async def test_rotation_and_issue_bundle_include_logs_but_no_config_or_credentials(self):
        self.assertIs(diagnostics.configure_logging(), self.logger)
        handler = next(h for h in self.logger.handlers if hasattr(h, "_packtool_file"))
        self.assertEqual(handler.maxBytes, 5 * 1024 * 1024)
        self.assertEqual(handler.backupCount, 5)
        self.logger.info("previous operation")
        handler.doRollover()
        self.logger.info("new operation")
        (self.logs / "builds").mkdir()
        (self.logs / "builds/1.log").write_text("storePassword=old-build-secret dpapi:old-encrypted-secret", encoding="utf-8")
        (self.root / "config").mkdir()
        (self.root / "config/settings.json").write_text('{"storePassword":"config-secret"}')
        desktop = self.root.parent / "logs"
        desktop.mkdir()
        (desktop / "startup.log").write_text("desktop boot diagnostic")
        with zipfile.ZipFile(io.BytesIO(diagnostics.diagnostic_bundle())) as archive:
            self.assertIn("logs/application.log.1", archive.namelist())
            self.assertIn("previous operation", archive.read("logs/application.log.1").decode())
            self.assertEqual(archive.read("desktop/startup.log"), b"desktop boot diagnostic")
            exported = archive.read("logs/builds/1.log").decode()
            self.assertNotIn("old-build-secret", exported)
            self.assertNotIn("old-encrypted-secret", exported)
            self.assertFalse(any(name.startswith("config/") for name in archive.namelist()))

    async def test_unwritable_file_logging_falls_back_without_failing_operation(self):
        self.close_logger()
        with patch.object(diagnostics, "RotatingFileHandler", side_effect=PermissionError("denied")):
            logger = diagnostics.configure_logging()
        self.assertIsInstance(logger.handlers[-1], logging.StreamHandler)
        response = await self.request("/api/config", "POST")
        self.assertEqual(next(item for item in response if item["type"] == "http.response.start")["status"], 200)
