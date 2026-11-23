"""Local reusable Android signing profiles. Passwords are protected with DPAPI."""
import datetime
import hashlib
import json
import os
import threading
import uuid
from copy import deepcopy
from contextlib import contextmanager
from pathlib import Path

from .config import DEFAULT_CONFIG
from .paths import CONFIG_DIR
from .secret_store import unprotect
from .signing import protect_config, signing_error, signing_passwords

KEYS_PATH = CONFIG_DIR / "signing_keys.json"
_lock = threading.RLock()
_fields = tuple(key for key in DEFAULT_CONFIG["signing"] if key != "keyId")


def _read() -> dict:
    if not KEYS_PATH.exists():
        return {"keys": [], "importedApps": {}}
    try:
        data = json.loads(KEYS_PATH.read_text(encoding="utf-8"))
        if not isinstance(data.get("keys"), list) or not isinstance(data.get("importedApps"), dict):
            raise ValueError
        ids = set()
        for key in data["keys"]:
            if (not isinstance(key, dict) or not isinstance(key.get("id"), str) or not key["id"]
                    or key["id"] in ids or not isinstance(key.get("name"), str)
                    or not isinstance(key.get("signing"), dict)
                    or not all(isinstance(value, str) for value in key["signing"].values())):
                raise ValueError
            ids.add(key["id"])
        return data
    except (OSError, ValueError, AttributeError):
        raise ValueError("无法读取本机密钥管理配置，请检查 config/signing_keys.json") from None


def _write(data: dict) -> None:
    KEYS_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = KEYS_PATH.with_name(KEYS_PATH.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=4), encoding="utf-8")
        temporary.replace(KEYS_PATH)
    finally:
        temporary.unlink(missing_ok=True)


def _find(data: dict, key_id: str) -> dict:
    for key in data["keys"]:
        if key["id"] == key_id:
            return key
    raise ValueError("所选共享密钥不存在，请在「密钥管理」重新选择")


def get_signing(key_id: str) -> dict:
    with _lock:
        return deepcopy(_find(_read(), key_id)["signing"])


@contextmanager
def reference_guard(key_id: str):
    with _lock:
        if key_id:
            _find(_read(), key_id)
        yield


def _usage(key_id: str) -> list[dict]:
    from . import apps

    return [{"id": app["id"], "name": app["name"]} for app in apps.list_apps()
            if apps.load_app_config(app["id"])["signing"].get("keyId") == key_id]


def list_keys() -> list[dict]:
    with _lock:
        return [{**deepcopy(key), "usedBy": _usage(key["id"])} for key in _read()["keys"]]


def save_key(name: str, signing: dict, key_id: str = "") -> dict:
    name = name.strip()
    if not name or len(name) > 80:
        raise ValueError("请填写 1 到 80 个字符的密钥名称")
    with _lock:
        data = _read()
        existing = _find(data, key_id) if key_id else None
        settings = {key: value for key, value in DEFAULT_CONFIG["signing"].items() if key != "keyId"}
        if existing:
            settings.update(existing["signing"])
        settings.update({key: value for key, value in signing.items()
                         if key in (*_fields, "storePassword", "keyPassword")})
        if not all(isinstance(value, str) for value in settings.values()):
            raise ValueError("密钥配置字段应为文本")
        if settings.get("passwordMode") not in ("local", "env"):
            raise ValueError("请选择有效的密码方式")
        settings["keystorePath"] = settings["keystorePath"].strip()
        settings["keyAlias"] = settings["keyAlias"].strip()
        if not settings["keystorePath"]:
            raise ValueError("请选择签名文件")
        if error := signing_error({"signing": settings}):
            raise ValueError(error)
        protected = protect_config({"signing": settings})["signing"]
        record = {"id": key_id or uuid.uuid4().hex[:12], "name": name, "signing": protected,
                  "updatedAt": datetime.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S")}
        if existing:
            data["keys"][data["keys"].index(existing)] = record
        else:
            data["keys"].append(record)
        _write(data)
        return {**deepcopy(record), "usedBy": _usage(record["id"])}


def delete_key(key_id: str) -> None:
    with _lock:
        data = _read()
        key = _find(data, key_id)
        if _usage(key_id):
            raise ValueError("该密钥正在被应用使用，请先在这些应用中更换签名密钥")
        data["keys"].remove(key)
        _write(data)


def reveal_passwords(key_id: str) -> dict:
    store, key = signing_passwords({"signing": get_signing(key_id)})
    return {"storePassword": store, "keyPassword": key}


def _identity(signing: dict) -> tuple:
    path = os.path.normcase(os.path.normpath(str(signing.get("keystorePath") or "").strip()))
    alias = str(signing.get("keyAlias") or "").strip()
    mode = signing.get("passwordMode", "env")
    if mode == "env":
        return path, alias, mode, signing.get("storePasswordEnv"), signing.get("keyPasswordEnv") or signing.get("storePasswordEnv")
    def secret(field):
        if signing.get(field):
            return signing[field]
        encrypted = signing.get(field + "Encrypted") or ""
        try:
            return unprotect(encrypted) if encrypted else ""
        except ValueError:
            return encrypted
    store = secret("storePassword")
    return path, alias, mode, store, secret("keyPassword") or store


def import_app_keys() -> int:
    """Import each revision of legacy app signing settings without changing the app."""
    from . import apps

    with _lock:
        data = _read()
        added = 0
        changed = False
        for app in apps.list_apps():
            signing = apps.load_app_config(app["id"])["signing"]
            if signing.get("keyId") or not str(signing.get("keystorePath") or "").strip():
                continue
            protected = protect_config({"signing": {key: value for key, value in signing.items()
                if key in (*_fields, "storePassword", "keyPassword")}})["signing"]
            # Hash encrypted settings, never a low-entropy plaintext password.
            revision = hashlib.sha256(json.dumps(protected, sort_keys=True).encode("utf-8")).hexdigest()
            if data["importedApps"].get(app["id"]) == revision:
                continue
            identity = _identity(signing)
            if not any(_identity(key["signing"]) == identity for key in data["keys"]):
                data["keys"].append({"id": uuid.uuid4().hex[:12], "name": (app["name"] + " · " + Path(signing["keystorePath"]).stem)[:80],
                                     "signing": protected, "updatedAt": app["updatedAt"]})
                added += 1
            data["importedApps"][app["id"]] = revision
            changed = True
        if changed:
            _write(data)
        return added
