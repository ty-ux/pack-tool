"""Validate the current app's optional APK signing settings."""

import os
import re
from copy import deepcopy

from .secret_store import protect, unprotect


_ENV_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def resolve_signing(cfg: dict) -> dict:
    """Take a snapshot of the referenced profile before starting a build."""
    key_id = (cfg.get("signing") or {}).get("keyId")
    if not key_id:
        return cfg
    from .signing_keys import get_signing

    resolved = deepcopy(cfg)
    resolved["signing"] = get_signing(str(key_id))
    return resolved


def protect_config(cfg: dict) -> dict:
    """Consume password drafts once; only encrypted credentials may reach disk/API responses."""
    saved = deepcopy(cfg)
    signing = saved.get("signing") or {}
    if signing.get("keyId"):
        saved["signing"] = {"keyId": str(signing["keyId"])}
        return saved
    for field in ("storePassword", "keyPassword"):
        password = signing.pop(field, "")
        if signing.get("passwordMode") == "local" and password:
            if not isinstance(password, str) or len(password) > 65536:
                raise ValueError("签名密码格式无效")
            signing[field + "Encrypted"] = protect(password)
    return saved


def redact_config(cfg: dict) -> dict:
    clean = deepcopy(cfg)
    for field in ("storePassword", "keyPassword", "storePasswordEncrypted", "keyPasswordEncrypted"):
        (clean.get("signing") or {}).pop(field, None)
    return clean


def signing_passwords(cfg: dict) -> tuple[str, str]:
    cfg = resolve_signing(cfg)
    signing = cfg.get("signing") or {}
    if signing.get("passwordMode", "env") == "local":
        def password(field):
            draft = signing.get(field) or ""
            encrypted = signing.get(field + "Encrypted") or ""
            return draft or (unprotect(encrypted) if encrypted else "")
        store = password("storePassword")
        if not store:
            raise ValueError("请在「应用信息」填写密钥库密码并保存")
        return store, password("keyPassword") or store
    store_env = str(signing.get("storePasswordEnv") or "").strip()
    key_env = str(signing.get("keyPasswordEnv") or "").strip() or store_env
    for name in dict.fromkeys((store_env, key_env)):
        if not _ENV_NAME.fullmatch(name):
            raise ValueError("请填写有效的签名密码环境变量名（字母或下划线开头，其余可包含数字）")
        if not os.environ.get(name):
            raise ValueError(f"未读取到签名密码环境变量 {name}，可改用「直接填写」方式")
    return os.environ[store_env], os.environ[key_env]


def signing_environment(cfg: dict) -> dict[str, str]:
    cfg = resolve_signing(cfg)
    if not str((cfg.get("signing") or {}).get("keystorePath") or "").strip():
        return {}
    store, key = signing_passwords(cfg)
    return {"PACK_TOOL_SIGNING_STORE_PASSWORD": store, "PACK_TOOL_SIGNING_KEY_PASSWORD": key}


def signing_error(cfg: dict) -> str | None:
    try:
        cfg = resolve_signing(cfg)
    except ValueError as error:
        return str(error)
    signing = cfg.get("signing") or {}
    path = str(signing.get("keystorePath") or "").strip()
    if not path:
        return None
    if not os.path.isabs(path) or not os.path.isfile(path):
        return "请选择本机存在的签名文件（绝对路径）"
    if not str(signing.get("keyAlias") or "").strip():
        return "请填写签名密钥别名（Key Alias）"

    try:
        signing_passwords(cfg)
    except ValueError as error:
        return str(error)
    return None
