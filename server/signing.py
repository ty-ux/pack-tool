"""Validate the current app's optional APK signing settings."""

import os
import re


_ENV_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def signing_error(cfg: dict) -> str | None:
    signing = cfg.get("signing") or {}
    path = str(signing.get("keystorePath") or "").strip()
    if not path:
        return None
    if not os.path.isabs(path) or not os.path.isfile(path):
        return "请选择本机存在的签名文件（绝对路径）"
    if not str(signing.get("keyAlias") or "").strip():
        return "请填写签名密钥别名（Key Alias）"

    store_env = str(signing.get("storePasswordEnv") or "").strip()
    key_env = str(signing.get("keyPasswordEnv") or "").strip() or store_env
    for name in dict.fromkeys((store_env, key_env)):
        if not _ENV_NAME.fullmatch(name):
            return "请填写有效的签名密码环境变量名（字母或下划线开头，其余可包含数字）"
        if not os.environ.get(name):
            return f"未读取到签名密码环境变量 {name}，请设置后重新启动打包工具"
    return None
