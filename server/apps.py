"""多应用配置：每个应用一份 config/apps/<id>.json，config/active_app.json 记录当前应用"""
import copy
import datetime
import json
import threading
import uuid

from .config import DEFAULT_CONFIG, deep_merge
from .paths import ACTIVE_APP_PATH, APPS_DIR, CONFIG_PATH

# 新建应用沿用的机器级路径；projectDir 属于应用本身，不继承
INHERITED_PATHS = ("hbuilderxCli", "integrateDir", "javaHome", "adb", "outputDir", "webOutputDir")

_ensure_lock = threading.Lock()


def _now() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _write_json(path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)


def _app_path(app_id: str):
    return APPS_DIR / f"{app_id}.json"


def _app_files() -> list:
    return sorted(APPS_DIR.glob("*.json")) if APPS_DIR.exists() else []


def _read_app(app_id: str) -> dict | None:
    """读单个应用：文件里的配置深合并到默认值上，缺字段不会导致前端崩溃"""
    raw = _read_json(_app_path(app_id))
    if not raw or not isinstance(raw.get("config"), dict):
        return None
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    deep_merge(cfg, raw["config"])
    return {"id": app_id, "updatedAt": str(raw.get("updatedAt") or ""), "config": cfg}


def _write_app(app_id: str, cfg: dict) -> dict:
    now = _now()
    existing = _read_json(_app_path(app_id)) or {}
    record = {
        "id": app_id,
        "createdAt": existing.get("createdAt") or now,
        "updatedAt": now,
        "config": cfg,
    }
    _write_json(_app_path(app_id), record)
    return {"id": app_id, "updatedAt": now, "config": cfg}


def _new_id() -> str:
    while True:
        app_id = uuid.uuid4().hex[:8]
        if not _app_path(app_id).exists():
            return app_id


def _ensure_store() -> None:
    """首次使用：把旧版单份配置迁成一个应用；没有旧配置就从默认值建一个"""
    if _app_files():
        return
    with _ensure_lock:
        if _app_files():
            return
        cfg = copy.deepcopy(DEFAULT_CONFIG)
        legacy = _read_json(CONFIG_PATH) if CONFIG_PATH.exists() else None
        if legacy:
            deep_merge(cfg, legacy)
            # 迁移后改名，避免误以为改 pack_config.json 还能生效
            try:
                CONFIG_PATH.replace(CONFIG_PATH.with_name("pack_config.legacy.json"))
            except OSError:
                pass
        _write_json(ACTIVE_APP_PATH, {"id": _write_app(_new_id(), cfg)["id"]})


def set_active(app_id: str) -> None:
    if not _app_path(app_id).exists():
        raise FileNotFoundError(f"应用不存在: {app_id}")
    _write_json(ACTIVE_APP_PATH, {"id": app_id})


def active_id() -> str:
    _ensure_store()
    data = _read_json(ACTIVE_APP_PATH) or {}
    app_id = str(data.get("id") or "")
    if app_id and _app_path(app_id).exists():
        return app_id
    files = _app_files()
    if not files:
        return ""
    set_active(files[0].stem)
    return files[0].stem


def list_apps() -> list[dict]:
    _ensure_store()
    items = []
    for path in _app_files():
        app = _read_app(path.stem)
        if not app:
            continue
        cfg = app["config"]
        items.append({
            "id": app["id"],
            "name": str((cfg.get("app") or {}).get("name") or "未命名应用"),
            "appid": str((cfg.get("app") or {}).get("appid") or ""),
            "packageName": str((cfg.get("android") or {}).get("packageName") or ""),
            "updatedAt": app["updatedAt"],
        })
    items.sort(key=lambda x: x["name"])
    return items


def load_active_config() -> dict:
    app = _read_app(active_id())
    return app["config"] if app else copy.deepcopy(DEFAULT_CONFIG)


def save_active_config(cfg: dict) -> dict:
    app_id = active_id()
    if not app_id:
        _ensure_store()
        app_id = active_id()
    return _write_app(app_id, cfg)


def create_app(name: str) -> dict:
    """新建应用：默认值 + 沿用当前应用的机器级路径/构建目标/安装配置"""
    base = load_active_config()
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    for key in INHERITED_PATHS:
        cfg["paths"][key] = (base.get("paths") or {}).get(key, cfg["paths"][key])
    cfg["build"] = copy.deepcopy(base.get("build") or cfg["build"])
    cfg["install"] = copy.deepcopy(base.get("install") or cfg["install"])
    # 应用自身的字段留空，等用户填写
    cfg["app"]["name"] = name.strip() or "新应用"
    cfg["app"]["appid"] = ""
    cfg["app"]["icon"] = ""
    cfg["android"]["packageName"] = ""

    app_id = _new_id()
    record = _write_app(app_id, cfg)
    set_active(app_id)
    return record


def delete_app(app_id: str) -> None:
    if not _app_path(app_id).exists():
        raise FileNotFoundError(f"应用不存在: {app_id}")
    if len(_app_files()) <= 1:
        raise ValueError("至少保留一个应用，不能删除最后一个")
    _app_path(app_id).unlink()
    if (_read_json(ACTIVE_APP_PATH) or {}).get("id") == app_id:
        set_active(_app_files()[0].stem)
