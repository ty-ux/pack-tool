"""Snapshot persistent user data before a new application version opens it."""
import datetime
import json
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


def create_backup(root: Path = DATA_ROOT) -> Path:
    with _lock:
        directory = root / "backups"
        directory.mkdir(parents=True, exist_ok=True)
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        target = directory / f"PackTool-{stamp}-{uuid.uuid4().hex[:8]}.zip"
        temporary = target.with_suffix(".tmp")
        try:
            with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("backup-info.json", json.dumps({
                    "format": "packtool-local-backup", "schemaVersion": 1,
                    "createdWith": __version__, "createdAt": datetime.datetime.now().isoformat(),
                    "note": "本机恢复备份，可能含敏感配置；加密密码仅限原 Windows 用户使用。",
                }, ensure_ascii=False))
                for name in PERSISTENT_DIRS:
                    base = root / name
                    if base.is_symlink() or not base.is_dir():
                        continue
                    for file in sorted(base.rglob("*")):
                        if not file.is_file() or file.is_symlink():
                            continue
                        relative = file.relative_to(root)
                        # Never follow directory junctions/symlinks outside the workspace.
                        if not file.resolve().is_relative_to(root.resolve()):
                            continue
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
