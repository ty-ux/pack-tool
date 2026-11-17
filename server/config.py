"""配置读写：默认值、权限字典、打包运行配置"""
import json

from .paths import RUN_CONFIG_PATH

# 可用的权限定义 (key -> 说明)
# level 供界面提示使用：blocked 仅系统应用 / deprecated 已弃用 / special 需系统设置单独授权 /
# sensitive 应用商店重点关注 / scoped 受 Android 版本或分区存储限制
PERMISSIONS = [
    {"key": "INTERNET", "label": "联网", "desc": "访问互联网（必需）"},
    {"key": "ACCESS_NETWORK_STATE", "label": "网络状态", "desc": "查看网络连接状态"},
    {"key": "CHANGE_NETWORK_STATE", "label": "修改网络状态", "desc": "更改网络连接状态"},
    {"key": "ACCESS_WIFI_STATE", "label": "WiFi状态", "desc": "查看WiFi状态"},
    {"key": "CHANGE_WIFI_STATE", "label": "修改WiFi", "desc": "更改WiFi连接状态"},
    {"key": "CAMERA", "label": "相机/扫码", "desc": "使用摄像头拍照、扫码"},
    {"key": "FLASHLIGHT", "label": "闪光灯", "desc": "控制闪光灯（扫码补光）"},
    {
        "key": "WRITE_EXTERNAL_STORAGE",
        "label": "写入存储",
        "desc": "保存文件到存储（Android 9-）",
        "level": "scoped",
        "note": "Android 10 起启用分区存储；Android 13+ 对媒体文件不再生效，请改用 READ_MEDIA_* 或应用专属目录。",
    },
    {
        "key": "READ_EXTERNAL_STORAGE",
        "label": "读取存储",
        "desc": "读取存储文件（Android 9-）",
        "level": "scoped",
        "note": "Android 13+ 不再生效；读取相册图片请改用 READ_MEDIA_IMAGES。",
    },
    {
        "key": "READ_MEDIA_IMAGES",
        "label": "读取图片",
        "desc": "读取相册图片（Android 13+）",
        "level": "scoped",
        "note": "仅 Android 13 及以上生效；Android 12 及以下仍需 READ_EXTERNAL_STORAGE。",
    },
    {
        "key": "REQUEST_INSTALL_PACKAGES",
        "label": "安装APK",
        "desc": "应用内安装/升级APK",
        "level": "special",
        "note": "需要在系统设置中允许「安装未知应用」，否则 plus.runtime.install 会直接失败。",
    },
    {"key": "VIBRATE", "label": "振动", "desc": "控制设备振动（扫码反馈）"},
    {"key": "WAKE_LOCK", "label": "唤醒锁", "desc": "保持屏幕唤醒"},
    {
        "key": "READ_PHONE_STATE",
        "label": "手机状态",
        "desc": "读取设备标识信息",
        "level": "sensitive",
        "note": "可读取设备标识，应用商店会重点审核；Android 10+ 普通应用无法获取 IMEI。",
    },
    {
        "key": "GET_ACCOUNTS",
        "label": "账户",
        "desc": "获取账户信息",
        "level": "deprecated",
        "note": "Android 8.0 起已弃用，需要账号同步适配器配合，新项目建议直接移除。",
    },
    {
        "key": "READ_LOGS",
        "label": "读取日志",
        "desc": "读取系统日志",
        "level": "blocked",
        "note": "系统签名权限，普通应用声明后不会授予；调试请使用 adb logcat。",
    },
    {
        "key": "WRITE_SETTINGS",
        "label": "修改设置",
        "desc": "修改系统设置",
        "level": "special",
        "note": "必须在系统设置页由用户手动开启，声明后不会自动授予。",
    },
]

DEFAULT_CONFIG = {
    "app": {
        "name": "新应用",
        "icon": "",
        "appid": "",
        "versionName": "1.0.0",
        "versionCode": "1",
    },
    "android": {
        "packageName": "",
        "permissions": ["INTERNET", "ACCESS_NETWORK_STATE", "CAMERA", "WRITE_EXTERNAL_STORAGE", "READ_EXTERNAL_STORAGE", "READ_MEDIA_IMAGES", "REQUEST_INSTALL_PACKAGES", "VIBRATE", "WAKE_LOCK"],
    },
    "signing": {
        "keystorePath": "",
        "keyAlias": "",
        "storePasswordEnv": "PACK_TOOL_KEYSTORE_PASSWORD",
        "keyPasswordEnv": "",
    },
    "build": {
        "buildType": "debug",  # debug / release
        "platform": "apk",     # apk / web / wgt
        "webType": "h5",       # pc (网站-PC Web) / h5 (手机H5)
    },
    "web": {
        "webTitle": "",
        "webDomain": "",
        "ssr": False,
    },
    "paths": {
        "hbuilderxCli": "",
        "projectDir": "",
        "integrateDir": "",
        "javaHome": "",
        "adb": "",
        "outputDir": "",
        "webOutputDir": "",
    },
    "install": {
        "enabled": False,
        "serial": "",
        "launch": True,
    },
}


def deep_merge(base: dict, override: dict) -> None:
    for k, v in override.items():
        if k in base and isinstance(base[k], dict) and isinstance(v, dict):
            deep_merge(base[k], v)
        else:
            base[k] = v


def load_config() -> dict:
    """当前应用的配置（首次调用时把旧版 pack_config.json 迁成第一个应用）"""
    from . import apps

    return apps.load_active_config()


def save_config(cfg: dict) -> None:
    from . import apps

    apps.save_active_config(cfg)


def write_run_config(cfg: dict) -> str:
    """把当前配置深拷贝写到 build_config.json（ps1 读取用），返回路径字符串"""
    RUN_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(RUN_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=4)
    return str(RUN_CONFIG_PATH)
