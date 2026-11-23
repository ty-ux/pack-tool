"""Snapshot persistent user data before a new application version opens it."""
import datetime
import json
import logging
import os
import sqlite3
import tempfile
import threading
import uuid
import zipfile
from contextlib import closing
from pathlib import Path

from . import __version__
from .paths import DATA_ROOT
from .storage import write_json

_lock = threading.RLock()
PERSISTENT_DIRS = ("config", "packages", "logs", "data", "output", "icon")
GRADLE_CACHE_DIRS = frozenset(("caches", "daemon", "native", "wrapper", ".tmp",
                               "kotlin-profile", "notifications", "workers", "jdks"))
logger = logging.getLogger(__name__)


def _backup_files(root: Path):
    resolved_root = root.resolve()

    def raise_walk_error(error):
        raise error

    for name in PERSISTENT_DIRS:
        base = root / name
        if base.is_symlink() or not base.is_dir() or not base.resolve().is_relative_to(resolved_root):
            continue
        # Prune caches before traversal; even enumerating them can take seconds.
        for directory, dirs, files in os.walk(base, topdown=True, onerror=raise_walk_error):
            parent = Path(directory)
            dirs[:] = sorted(child for child in dirs
                             if not (parent.relative_to(root).as_posix() == "data/flutter-gradle"
                                     and child.casefold() in GRADLE_CACHE_DIRS)
                             and not (parent / child).is_symlink()
                             and (parent / child).resolve().is_relative_to(resolved_root))
            for name in sorted(files):
                file = parent / name
                if file.is_file() and not file.is_symlink() and file.resolve().is_relative_to(resolved_root):
                    yield file


def create_backup(root: Path = DATA_ROOT) -> Path:
    with _lock:
        directory = root / "backups"
        directory.mkdir(parents=True, exist_ok=True)
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        target = directory / f"PackTool-{stamp}-{uuid.uuid4().hex[:8]}.zip"
        temporary = target.with_suffix(".tmp")
        logger.info("Creating user-data backup: %s", target)
        try:
            with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("backup-info.json", json.dumps({
                    "format": "packtool-local-backup", "schemaVersion": 1,
                    "createdWith": __version__, "createdAt": datetime.datetime.now().isoformat(),
                    "note": "本机恢复备份，可能含敏感配置；加密密码仅限原 Windows 用户使用。",
                }, ensure_ascii=False))
                for file in _backup_files(root):
                    relative = file.relative_to(root)
                    if relative.as_posix() in ("data/build_history.db-wal", "data/build_history.db-shm"):
                        continue
                    if relative.as_posix() == "data/build_history.db":
                        # Include committed WAL entries using SQLite's snapshot API.
                        with tempfile.TemporaryDirectory() as scratch:
                            snapshot = Path(scratch) / "history.db"
                            with closing(sqlite3.connect(file.resolve().as_uri() + "?mode=ro", uri=True)) as source:
                                with closing(sqlite3.connect(snapshot)) as destination:
                                    source.backup(destination)
                            archive.write(snapshot, relative.as_posix())
                    else:
                        archive.write(file, relative.as_posix())
            temporary.replace(target)
            logger.info("User-data backup completed: %s (%d bytes)", target.name, target.stat().st_size)
        finally:
            temporary.unlink(missing_ok=True)
        return target


def ensure_data_version(root: Path = DATA_ROOT, version: str = __version__) -> None:
    with _lock:
        marker = root / "data-version.json"
        previous = None
        if marker.exists():
            try:
                previous = json.loads(marker.read_text(encoding="utf-8"))["appVersion"]
            except (ValueError, KeyError, TypeError):
                raise RuntimeError("用户数据版本文件损坏，请先备份数据后检查 data-version.json") from None
        if previous == version:
            return
        has_data = any((root / name).exists() for name in PERSISTENT_DIRS)
        # Failure aborts startup before any legacy migration or configuration write.
        backup = create_backup(root) if has_data else None
        write_json(marker, {"appVersion": version, "previousVersion": previous,
                            "backup": backup.name if backup else None})


def data_info() -> dict:
    backup_dir = DATA_ROOT / "backups"
    backups = sorted(backup_dir.glob("PackTool-*.zip"), reverse=True) if backup_dir.exists() else []
    return {"root": str(DATA_ROOT), "version": __version__,
            "backups": [{"name": file.name, "size": file.stat().st_size} for file in backups]}
