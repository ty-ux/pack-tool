"""构建历史：SQLite 存储 + 日志归档 + 保留策略"""
import json
import shutil
import sqlite3
import datetime
from pathlib import Path

from .paths import BUILD_LOG, DATA_ROOT, LOGS_DIR

DATA_DIR = DATA_ROOT / "data"
DB_PATH = DATA_DIR / "build_history.db"
ARCHIVE_DIR = LOGS_DIR / "builds"
MAX_KEEP = 100  # 保留策略：最多保留的构建记录数


def _now() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS builds (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                duration_ms INTEGER,
                platform TEXT NOT NULL,
                web_type TEXT NOT NULL,
                build_type TEXT NOT NULL,
                target_desc TEXT,
                status TEXT NOT NULL DEFAULT 'running',
                artifact_path TEXT,
                log_path TEXT,
                config_snapshot TEXT
            )
            """
        )


# ---------------- 写入 ----------------
def create_build(meta: dict, config_snapshot: dict) -> int:
    init_db()
    with _connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO builds (started_at, platform, web_type, build_type, target_desc, status, config_snapshot)
            VALUES (?, ?, ?, ?, ?, 'running', ?)
            """,
            (
                meta["started_at"],
                meta["platform"],
                meta["web_type"],
                meta["build_type"],
                meta.get("target_desc", ""),
                json.dumps(config_snapshot, ensure_ascii=False),
            ),
        )
        return cur.lastrowid


def finish_build(build_id: int, status: str, artifact_path: str = "", log_path: str = "") -> None:
    """结算构建：状态、产物路径、日志路径、结束时间、耗时"""
    finished = _now()
    duration_ms = None
    with _connect() as conn:
        row = conn.execute("SELECT started_at FROM builds WHERE id = ?", (build_id,)).fetchone()
        if row:
            try:
                start = datetime.datetime.strptime(row[0], "%Y-%m-%d %H:%M:%S")
                duration_ms = int((datetime.datetime.now() - start).total_seconds() * 1000)
            except ValueError:
                pass
        conn.execute(
            """
            UPDATE builds SET status = ?, artifact_path = ?, log_path = ?,
                finished_at = ?, duration_ms = ?
            WHERE id = ?
            """,
            (status, artifact_path, log_path, finished, duration_ms, build_id),
        )


def archive_log(build_id: int) -> str:
    """把当前 build.log 归档为 logs/builds/{id}.log，返回相对 logs 的路径"""
    if not BUILD_LOG.exists():
        return ""
    dest = ARCHIVE_DIR / f"build-{build_id}.log"
    shutil.copyfile(BUILD_LOG, dest)
    return str(dest.relative_to(LOGS_DIR))


def resolve_status(log_text: str) -> str:
    """从日志末尾判定最终状态（与前端判定逻辑保持一致）"""
    tail = log_text[-4000:]
    if "BUILD-CANCELLED" in tail:
        return "cancelled"
    ok = "BUILD-OK" in tail or "全部完成" in tail
    err = (
        "BUILD FAILED" in tail
        or "BUILD-FAILED" in tail
        or "Gradle 打包失败" in tail
        or "前端资源编译失败" in tail
        or "Web 发行失败" in tail
        or "WGT 制作失败" in tail
    )
    if ok and not err:
        return "ok"
    return "fail"


def resolve_artifact(log_text: str) -> str:
    """从日志里解析产物路径（APK 复制行 / Web 产物行）"""
    for line in log_text.splitlines():
        s = line.strip()
        for marker in ("构建产物:", "APK 已复制到:", "Web 发行成功，产物:", "WGT 已复制到:"):
            idx = s.find(marker)
            if idx >= 0:
                return s[idx + len(marker):].strip()
    return ""


# ---------------- 查询 ----------------
def list_builds(limit: int = 20, platform: str = "", offset: int = 0) -> list[dict]:
    init_db()
    with _connect() as conn:
        sql = "SELECT * FROM builds"
        params: list = []
        if platform in ("apk", "aab", "web", "wgt"):
            sql += " WHERE platform = ?"
            params.append(platform)
        sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
        params += [limit, offset]
        rows = conn.execute(sql, params).fetchall()
        cols = [d[0] for d in conn.execute("SELECT * FROM builds LIMIT 0").description]
        return [_row_to_dict(dict(zip(cols, r))) for r in rows]


def get_build(build_id: int) -> dict | None:
    init_db()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM builds WHERE id = ?", (build_id,)).fetchone()
        if not row:
            return None
        cols = [d[0] for d in conn.execute("SELECT * FROM builds LIMIT 0").description]
        return _row_to_dict(dict(zip(cols, row)))


def _row_to_dict(row: dict) -> dict:
    out = dict(row)
    if out.get("config_snapshot"):
        try:
            out["config_snapshot"] = json.loads(out["config_snapshot"])
        except (json.JSONDecodeError, TypeError):
            out["config_snapshot"] = None
    return out


def read_archive_log(log_path: str) -> str:
    """读取归档日志（相对 logs 目录），编码容错"""
    p = (LOGS_DIR / log_path) if log_path else None
    if not p or not p.exists():
        return ""
    raw = p.read_bytes()
    for enc in ("utf-8", "gbk"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def cleanup(max_keep: int = MAX_KEEP) -> int:
    """删除超出保留上限的最老记录及其归档日志，返回删除条数"""
    init_db()
    deleted = 0
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, log_path FROM builds ORDER BY id DESC LIMIT -1 OFFSET ?", (max_keep,)
        ).fetchall()
        for bid, log_path in rows:
            conn.execute("DELETE FROM builds WHERE id = ?", (bid,))
            if log_path:
                (LOGS_DIR / log_path).unlink(missing_ok=True)
            deleted += 1
    return deleted


def clear_all() -> int:
    """清空全部历史（含归档日志），返回删除条数"""
    init_db()
    with _connect() as conn:
        rows = conn.execute("SELECT id, log_path FROM builds").fetchall()
        for bid, log_path in rows:
            if log_path:
                (LOGS_DIR / log_path).unlink(missing_ok=True)
        conn.execute("DELETE FROM builds")
        return len(rows)
