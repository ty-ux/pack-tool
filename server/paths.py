"""路径常量：全项目单一事实源"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SCRIPTS_DIR = BASE_DIR / "scripts"
WEB_DIR = BASE_DIR / "web"
DIST_DIR = WEB_DIR / "dist"

CONFIG_DIR = BASE_DIR / "config"
CONFIG_PATH = CONFIG_DIR / "pack_config.json"         # 旧版单应用配置（仅用于一次性迁移）
RUN_CONFIG_PATH = CONFIG_DIR / "build_config.json"
APPS_DIR = CONFIG_DIR / "apps"                        # 每个应用一份配置
ACTIVE_APP_PATH = CONFIG_DIR / "active_app.json"      # 当前应用指针

PACKAGES_DIR = BASE_DIR / "packages"                  # 可管理依赖包的源文件目录
PACKAGES_PATH = CONFIG_DIR / "packages.json"          # 依赖包清单（勾选状态）

LOGS_DIR = BASE_DIR / "logs"
BUILD_LOG = LOGS_DIR / "build.log"


def fspath(p) -> str:
    """转成 Windows 字符串路径再传给 subprocess / open"""
    return os.fspath(p)