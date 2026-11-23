"""Portable application profiles, without passwords or machine-bound secrets."""
import datetime
from copy import deepcopy

from . import __version__, apps
from .config import DEFAULT_CONFIG, deep_merge
from .signing import redact_config, resolve_signing

FORMAT = "packtool-config"
MAX_APPS = 100


def _portable(config: dict) -> dict:
    cfg = redact_config(config)
    signing = cfg.get("signing") or {}
    signing.pop("keyId", None)
    cfg["signing"] = signing
    return cfg


def export_config() -> dict:
    profiles = []
    for app in apps.list_apps():
        config = apps.load_app_config(app["id"])
        profiles.append({"config": _portable(resolve_signing(config))})
    return {"format": FORMAT, "schemaVersion": 1, "appVersion": __version__,
            "exportedAt": datetime.datetime.now().isoformat(), "apps": profiles}


def _validate(value, template, path="config") -> None:
    if isinstance(template, dict):
        if not isinstance(value, dict):
            raise ValueError(f"{path} 必须是对象")
        for key, child in value.items():
            if key not in template:
                raise ValueError(f"不支持的配置字段: {path}.{key}")
            _validate(child, template[key], f"{path}.{key}")
    elif isinstance(template, list):
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            raise ValueError(f"{path} 必须是字符串数组")
    elif type(value) is not type(template):
        raise ValueError(f"{path} 类型无效")


def validate_bundle(bundle: dict) -> list[dict]:
    if bundle.get("format") != FORMAT or type(bundle.get("schemaVersion")) is not int or bundle["schemaVersion"] != 1:
        raise ValueError("不支持的配置文件格式或版本，请使用 PackTool 导出的配置 JSON")
    profiles = bundle.get("apps")
    if not isinstance(profiles, list) or not 1 <= len(profiles) <= MAX_APPS:
        raise ValueError(f"配置文件必须包含 1 到 {MAX_APPS} 个应用")
    validated = []
    for profile in profiles:
        if not isinstance(profile, dict) or not isinstance(profile.get("config"), dict):
            raise ValueError("应用配置格式无效")
        if "signing" in profile["config"] and not isinstance(profile["config"]["signing"], dict):
            raise ValueError("config.signing 必须是对象")
        config = _portable(profile["config"])
        _validate(config, DEFAULT_CONFIG)
        merged = deepcopy(DEFAULT_CONFIG)
        deep_merge(merged, config)
        if merged["projectType"] not in ("uniapp", "android", "flutter", "react-native", "wechat-miniprogram"):
            raise ValueError("不支持的工程类型")
        if merged["signing"]["passwordMode"] not in ("local", "env"):
            raise ValueError("不支持的签名密码方式")
        if not merged["app"]["name"].strip():
            raise ValueError("应用名称不能为空")
        validated.append(merged)
    return validated


def preview_import(bundle: dict) -> list[dict]:
    from pathlib import Path
    rows = []
    for config in validate_bundle(bundle):
        paths = {**config["paths"], "icon": config["app"]["icon"],
                 "keystorePath": config["signing"]["keystorePath"],
                 "privateKeyPath": config["wechat"]["privateKeyPath"]}
        rows.append({"name": config["app"]["name"], "projectType": config["projectType"],
                     "missingPaths": [key for key, value in paths.items() if value and not Path(value).exists()]})
    return rows


def import_config(bundle: dict) -> list[str]:
    configs = validate_bundle(bundle)
    # Validate everything before creating files. Fresh identities leave existing apps,
    # active selection, logs, history and global package settings untouched.
    apps.active_id()
    created = []
    try:
        for config in configs:
            app_id = apps._new_id()
            created.append(app_id)
            apps._write_app(app_id, config)
    except Exception:
        for app_id in created:
            apps._app_path(app_id).unlink(missing_ok=True)
        raise
    return created
