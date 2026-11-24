"""Local operation logs, request correlation and a bounded issue diagnostic bundle."""
import contextvars
import datetime
import io
import json
import logging
import os
import re
import threading
import time
import uuid
import zipfile
from logging.handlers import RotatingFileHandler
from pathlib import Path

from . import __version__
from .paths import DATA_ROOT, LOGS_DIR

OPERATION_LOG = LOGS_DIR / "application.log"
request_id = contextvars.ContextVar("packtool_request_id", default="-")
_lock = threading.RLock()
_secret = re.compile(
    r'''(?i)((?:\b[\w-]{0,40}(?:password|token|secret)[\w-]{0,40}|\bauthorization|\bprivateKey)\s*["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)''')


def redact(text: str) -> str:
    text = re.sub(r"-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----", "[REDACTED PRIVATE KEY]", text, flags=re.S)
    text = re.sub(r"(?i)\b(?:dpapi:|Bearer\s+)[A-Za-z0-9+/=._-]+", "[REDACTED]", text)
    return _secret.sub(lambda match: match[1] + '"[REDACTED]"', text)


class _Formatter(logging.Formatter):
    def format(self, record):
        # Do not mutate the record shared with the separate sync/desktop logs.
        text = super().format(record)
        return redact(f"{self.formatTime(record)} {record.levelname} v{__version__} "
                      f"pid={os.getpid()} request={request_id.get()} {record.name}: {text}")


def configure_logging() -> logging.Logger:
    logger = logging.getLogger("packtool")
    with _lock:
        expected = str(OPERATION_LOG.resolve())
        current = next((h for h in logger.handlers if getattr(h, "_packtool_file", None) == expected), None)
        if current is None:
            for handler in logger.handlers[:]:
                if hasattr(handler, "_packtool_file"):
                    logger.removeHandler(handler)
                    handler.close()
            try:
                OPERATION_LOG.parent.mkdir(parents=True, exist_ok=True)
                current = RotatingFileHandler(OPERATION_LOG, maxBytes=5 * 1024 * 1024,
                                              backupCount=5, encoding="utf-8")
            except OSError:
                current = logging.StreamHandler()
            current._packtool_file = expected
            current.setFormatter(_Formatter())
            logger.addHandler(current)
            logger.setLevel(logging.INFO)
            logger.propagate = False
    return logger


class OperationLogMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope.get("path", "").startswith("/api/"):
            return await self.app(scope, receive, send)
        logger = configure_logging()
        correlation = uuid.uuid4().hex[:16]
        token = request_id.set(correlation)
        started = time.monotonic()
        status = 500
        body = bytearray()
        is_json = False
        failed = False
        response_started = False

        async def logged_send(message):
            nonlocal status, is_json, response_started
            if message["type"] == "http.response.start":
                status = message["status"]
                response_started = True
                headers = list(message.get("headers", []))
                is_json = any(k.lower() == b"content-type" and b"application/json" in v for k, v in headers)
                message = {**message, "headers": headers + [(b"x-request-id", correlation.encode())]}
            elif message["type"] == "http.response.body" and is_json and len(body) < 65536:
                body.extend(message.get("body", b"")[:65536 - len(body)])
            await send(message)

        try:
            logger.info("operation.begin method=%s", scope["method"])
            await self.app(scope, receive, logged_send)
        except Exception:
            failed = True
            logger.exception("operation.exception method=%s", scope["method"])
            if response_started:
                raise
            # Include correlation even when an exception escapes the route handler.
            from starlette.responses import JSONResponse
            await JSONResponse({"detail": "操作失败，请根据日志编号检查全局日志"}, status_code=500)(scope, receive, logged_send)
        finally:
            business_failed = False
            reason = ""
            if is_json:
                try:
                    result = json.loads(body)
                    if isinstance(result, dict) and result.get("ok") is False:
                        business_failed = True
                        reason = str(result.get("error") or "")[:2000]
                except (ValueError, UnicodeError):
                    business_failed = bool(re.match(rb'\s*\{\s*"ok"\s*:\s*false', body))
            level = logging.ERROR if failed or status >= 500 else logging.WARNING if business_failed or status >= 400 else logging.INFO
            route = getattr(scope.get("route"), "path", "/api/unmatched")
            logger.log(level, "operation.end method=%s route=%s status=%s result=%s duration_ms=%d%s",
                       scope["method"], route, status, "failed" if failed or business_failed or status >= 400 else "ok",
                       (time.monotonic() - started) * 1000, f" error={reason}" if reason else "")
            request_id.reset(token)


def log_info() -> dict:
    configure_logging()
    return {"directory": str(LOGS_DIR), "operationLog": str(OPERATION_LOG), "maxFileMiB": 5,
            "retainedFiles": 6}


def diagnostic_bundle() -> bytes:
    """Only known log files, never configuration/DB/certificates or arbitrary paths."""
    logger = configure_logging()
    logger.info("diagnostics.export")
    candidates = [LOGS_DIR / name for name in (
        "application.log", *(f"application.log.{n}" for n in range(1, 6)),
        "packages-sync.log", *(f"packages-sync.log.{n}" for n in range(1, 4)), "build.log")]
    archived = LOGS_DIR / "builds"
    if archived.is_dir():
        candidates.extend(sorted((p for p in archived.glob("*.log") if not p.is_symlink()),
                                 key=lambda p: p.stat().st_mtime, reverse=True)[:10])
    # Desktop startup logs live beside workspace, not inside the versioned data.
    desktop_logs = DATA_ROOT.parent / "logs"
    if DATA_ROOT.name == "workspace":
        candidates.extend(desktop_logs / name for name in ("startup.log", "startup.log.1", "update.log", "update.log.1"))
    report = {"version": __version__, "createdAt": datetime.datetime.now().isoformat(), "files": [],
              "note": "包含本机路径和构建工具输出，请在提交 issue 前检查内容。每个日志最多导出末尾 1 MiB；不含配置和凭据文件。"}
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for file in candidates:
            if file.is_symlink() or not file.is_file():
                continue
            allowed = desktop_logs if file.parent == desktop_logs else LOGS_DIR
            if not file.resolve().is_relative_to(allowed.resolve()):
                continue
            try:
                with file.open("rb") as stream:
                    size = stream.seek(0, 2)
                    offset = max(0, size - 1024 * 1024)
                    stream.seek(offset)
                    content = stream.read(1024 * 1024)
                if offset and b"\n" in content:
                    content = content.split(b"\n", 1)[1]
                try:
                    text = content.decode("utf-8")
                except UnicodeDecodeError:
                    text = content.decode("gbk", errors="replace")
                name = ("desktop/" if file.parent == desktop_logs else "logs/") + file.relative_to(allowed).as_posix()
                archive.writestr(name, redact(text))
                report["files"].append({"name": name, "tailOnly": offset > 0, "originalBytes": size})
            except OSError as error:
                report["files"].append({"name": file.name, "unavailable": type(error).__name__})
        archive.writestr("diagnostics.json", json.dumps(report, ensure_ascii=False, indent=2))
    return output.getvalue()
