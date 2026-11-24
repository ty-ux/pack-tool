"""依赖包管理：清单读写（config/packages.json）+ 同步对齐（packages/ -> simpleDemo/libs）

同步为"对齐"语义：启用的包从 packages/ 复制到 simpleDemo/libs/，
清单内被禁用的包从 libs 删除；清单外文件（手工放置/缓存）一律不动。
清单除内置包外，还支持用户在页面上传的自定义包（packages.json 的 custom 数组）。
"""
import copy
import datetime
import json
import logging
import os
import shutil
import uuid
import threading
from pathlib import Path
from logging.handlers import RotatingFileHandler

from . import __version__
from . import config as config_mod
from .paths import LOGS_DIR, PACKAGES_DIR, PACKAGES_PATH
from .storage import write_json

SYNC_LOG = LOGS_DIR / "packages-sync.log"
_logger_lock = threading.Lock()


def _sync_logger() -> logging.Logger:
    logger = logging.getLogger("packtool.packages")
    with _logger_lock:
        if not logger.handlers:
            try:
                SYNC_LOG.parent.mkdir(parents=True, exist_ok=True)
                handler = RotatingFileHandler(SYNC_LOG, maxBytes=2 * 1024 * 1024,
                                              backupCount=3, encoding="utf-8")
            except OSError:
                # 日志目录不可写时仍执行同步，并在服务终端记录诊断。
                handler = logging.StreamHandler()
            handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
            logger.addHandler(handler)
            logger.setLevel(logging.INFO)
            logger.propagate = True
    return logger

# 可管理依赖包清单：id 为稳定标识；required 的包不可取消勾选
DEFAULT_PACKAGES = [
    {"id": "lib5plus", "file": "lib.5plus.base-release.aar", "type": "aar",
     "label": "5+ 基础库",
     "desc": "DCloud 5+ 基础运行环境，内置 wgt 热更新安装模块，必选",
     "required": True, "enabled": True},
    {"id": "uniapp-v8", "file": "uniapp-v8-release.aar", "type": "aar",
     "label": "uni-app v8 引擎",
     "desc": "v8 JS 引擎核心，运行 uni-app 页面必需，必选",
     "required": True, "enabled": True},
    {"id": "install-apk", "file": "install-apk-release.aar", "type": "aar",
     "label": "APK 安装模块",
     "desc": "DCloud 离线 SDK 的 APK 升级安装组件，plus.runtime.install 安装 APK 必需",
     "required": True, "enabled": True},
    {"id": "webview-x5", "file": "webview-x5-release.aar", "type": "aar",
     "label": "X5 WebView 基础模块",
     "desc": "DCloud 离线 SDK 腾讯 X5 WebView，旧 Android Vue 页面兼容",
     "required": False, "enabled": False},
    {"id": "weex-webview-x5", "file": "weex_webview-x5-release.aar", "type": "aar",
     "label": "X5 uni-app 页面模块",
     "desc": "DCloud 离线 SDK uni-app X5 页面适配模块",
     "required": False, "enabled": False},
    {"id": "gif", "file": "android-gif-drawable-1.2.29.aar", "type": "aar",
     "label": "GIF 动图库",
     "desc": "支持在 WebView 中播放 GIF 动图",
     "required": False, "enabled": True},
    {"id": "breakpad", "file": "breakpad-build-release.aar", "type": "aar",
     "label": "崩溃日志采集",
     "desc": "native 崩溃堆栈采集（breakpad）",
     "required": False, "enabled": True},
    {"id": "oaid", "file": "oaid_sdk_1.0.25.aar", "type": "aar",
     "label": "OAID 广告标识",
     "desc": "获取匿名设备标识 OAID（广告/统计场景）",
     "required": False, "enabled": True},
    {"id": "zip4j", "file": "zip4j-2.11.5.jar", "type": "jar",
     "label": "zip4j 压缩库",
     "desc": "wgt 热更新必需：DCloud 引用 net.lingala.zip4j.ZipFile 但 SDK 未内置，"
             "缺失会导致 wgt 安装时崩溃（NPE: Attempt to read from null array）",
     "required": False, "enabled": True},
]

_DEFAULT_BY_ID = {p["id"]: p for p in DEFAULT_PACKAGES}


def _now() -> str:
    return datetime.datetime.now().strftime("%H:%M:%S")


def _load_raw() -> dict:
    """读取 packages.json 原始结构（容错）：{"packages": [...内置包状态...], "custom": [...自定义包...]}"""
    data = {"packages": [], "custom": []}
    if PACKAGES_PATH.exists():
        try:
            with open(PACKAGES_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            return {"packages": [], "custom": []}
        if not isinstance(data, dict):
            return {"packages": [], "custom": []}
    return {
        "packages": data.get("packages") if isinstance(data.get("packages"), list) else [],
        "custom": data.get("custom") if isinstance(data.get("custom"), list) else [],
    }


def _write_raw(packages: list[dict], custom: list[dict]) -> None:
    write_json(PACKAGES_PATH, {"packages": packages, "custom": custom})


def load_packages() -> list[dict]:
    """读取清单：内置包为骨架 + 合并持久化 enabled 状态，再追加自定义包。

    新版本的默认包会自动出现；已删除的包、未知的 id 不会带回。
    """
    data = _load_raw()
    merged = [copy.deepcopy(p) for p in DEFAULT_PACKAGES]
    saved = {p["id"]: p for p in data["packages"]}
    for p in merged:
        if p["id"] in saved:
            p["enabled"] = bool(saved[p["id"]].get("enabled", p["enabled"]))
            p["enabled"] = p["enabled"] or p["required"]  # 必选包永不落空
    custom = []
    for c in data["custom"]:
        if not isinstance(c, dict) or not str(c.get("id", "")).startswith("custom-"):
            continue
        custom.append({
            "id": str(c["id"]), "file": str(c.get("file", "")),
            "type": "aar" if str(c.get("type", "")).lower() == "aar" else "jar",
            "label": str(c.get("label", "")).strip() or str(c.get("file", "")),
            "desc": str(c.get("desc", "")),
            "required": False,
            "enabled": bool(c.get("enabled", True)),
            "custom": True,
        })
    return merged + custom


def save_packages(items: list[dict]) -> list[dict]:
    """保存清单：内置包只接受已知 id，required 强制开启；自定义包保留未提及项，避免丢数据。"""
    data = _load_raw()
    custom_by_id = {c["id"]: c for c in data["custom"] if str(c.get("id", "")).startswith("custom-")}

    submitted = {it.get("id"): it for it in items if isinstance(it, dict)}
    previous = {p.get("id"): p for p in data["packages"] if isinstance(p, dict)}
    cleaned = []
    for doc in DEFAULT_PACKAGES:
        it = submitted.get(doc["id"], previous.get(doc["id"], doc))
        cleaned.append({
            **copy.deepcopy(doc),
            "enabled": bool(it.get("enabled", doc["enabled"])) or doc["required"],
        })
    # 只更新被提交的自定义包 enabled，未提及的一律原样保留
    for it in items:
        c = custom_by_id.get(it.get("id"))
        if c:
            c["enabled"] = bool(it.get("enabled", c.get("enabled", True)))
    _write_raw(cleaned, list(custom_by_id.values()))
    return cleaned + [copy.deepcopy(c) for c in custom_by_id.values()]


def create_custom_package(file_name: str, label: str, desc: str, file_obj) -> dict:
    """新增自定义依赖包：校验扩展名/文件名后落盘到 packages/，并写入清单。

    file_obj: 文件对象（FastAPI UploadFile），内容流式写入。
    返回新增的包条目；校验失败抛 ValueError。
    """
    raw = (file_name or "").replace("\\", "/")
    # 含路径分隔符说明试图路径穿越，直接拒绝
    if not raw or "/" in raw or raw in (".", ".."):
        raise ValueError("文件名不合法，请勿包含路径信息")
    name = os.path.basename(raw)
    ext = os.path.splitext(name)[1].lower()
    if ext not in (".aar", ".jar"):
        raise ValueError("仅支持 .aar / .jar 文件")
    PACKAGES_DIR.mkdir(parents=True, exist_ok=True)
    if os.path.exists(os.path.join(PACKAGES_DIR, name)):
        raise ValueError(f"packages/ 中已存在同名文件: {name}，请先改名再上传")

    pkg = {
        "id": f"custom-{uuid.uuid4().hex[:8]}",
        "file": name,
        "type": "aar" if ext == ".aar" else "jar",
        "label": (label or "").strip() or os.path.splitext(name)[0],
        "desc": (desc or "").strip(),
        "required": False,
        "enabled": True,
        "custom": True,
    }
    dst = os.path.join(PACKAGES_DIR, name)
    try:
        with open(dst, "wb") as f:
            shutil.copyfileobj(file_obj, f, length=1024 * 1024)
        if not os.path.getsize(dst):
            os.remove(dst)
            raise ValueError("上传的文件为空")
    except OSError as e:
        if os.path.exists(dst):
            try:
                os.remove(dst)
            except OSError:
                pass
        raise ValueError(f"文件保存失败: {e}")

    data = _load_raw()
    data["custom"].append(pkg)
    _write_raw(data["packages"], data["custom"])
    return pkg


def delete_custom_package(pkg_id: str) -> dict:
    """删除自定义依赖包：从清单移除，并删除 packages/ 源文件与 simpleDemo/libs 中的对应文件。"""
    if not str(pkg_id).startswith("custom-"):
        raise ValueError("仅支持删除自定义依赖包")
    data = _load_raw()
    remain, target = [], None
    for c in data["custom"]:
        if str(c.get("id", "")) == pkg_id:
            target = c
        else:
            remain.append(c)
    if target is None:
        raise ValueError("未找到该自定义依赖包")
    _write_raw(data["packages"], remain)

    name = str(target.get("file", ""))
    src = os.path.join(PACKAGES_DIR, name)
    if os.path.exists(src):
        try:
            os.remove(src)
        except OSError:
            pass
    # libs 内的对应文件一并移除（离线工程未配置时静默跳过，不影响删除操作）
    try:
        libs = _libs_dir()
        dst = os.path.join(libs, name)
        if os.path.exists(dst):
            os.remove(dst)
    except Exception:
        pass
    return {"id": pkg_id, "file": name, "label": target.get("label", "")}


def _libs_dir(cfg: dict | None = None) -> str:
    """simpleDemo/libs 目录（由离线工程路径推导）"""
    cfg = config_mod.load_config() if cfg is None else cfg
    integrate = (cfg.get("paths") or {}).get("integrateDir") or ""
    if not integrate or not os.path.isdir(integrate):
        raise FileNotFoundError(f"离线工程目录未配置或不存在: {integrate}，请先在路径配置页设置 integrateDir")
    libs = os.path.join(integrate, "simpleDemo", "libs")
    os.makedirs(libs, exist_ok=True)
    return libs


def _usable(file: Path) -> bool:
    return file.is_file() and file.stat().st_size > 0


def package_source(package: dict, cfg: dict | None = None) -> tuple[Path, str]:
    """Resolve built-ins from the selected SDK; custom uploads require their own source."""
    source = Path(PACKAGES_DIR) / package["file"]
    if _usable(source):
        return source, "packages"
    if source.exists():
        return source, "missing"
    cfg = config_mod.load_config() if cfg is None else cfg
    integrate = (cfg.get("paths") or {}).get("integrateDir") or ""
    sdk = Path(integrate) / "simpleDemo" / "libs" / package["file"]
    if integrate and not package.get("custom") and _usable(sdk):
        return sdk, "sdk"
    return source, "missing"


def describe_packages() -> list[dict]:
    cfg = config_mod.load_config()
    return [{**package, "source": package_source(package, cfg)[1]} for package in load_packages()]


def _cache_sdk_file(source: Path, target: Path) -> None:
    """Publish a complete SDK copy without overwriting an existing user source."""
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        shutil.copy2(source, temporary)
        try:
            os.link(temporary, target)
        except FileExistsError:
            pass
    finally:
        temporary.unlink(missing_ok=True)


def _same_file_content(first: Path, second: Path) -> bool:
    if not second.is_file() or first.stat().st_size != second.stat().st_size:
        return False
    with first.open("rb") as left, second.open("rb") as right:
        while block := left.read(1024 * 1024):
            if block != right.read(len(block)):
                return False
    return True


def sync_packages(log=None, cfg: dict | None = None) -> tuple[bool, list[dict], dict]:
    """把 packages/ 按清单对齐到 simpleDemo/libs。

    log: 可选回调 (str) -> None，用于把进度写入构建日志。
    返回 (是否全部成功, 每包结果列表, 汇总 dict)。
    """
    logger = _sync_logger()
    sync_id = uuid.uuid4().hex[:12]
    logger.info("[%s] 开始同步 PackTool=%s source=%s", sync_id, __version__, PACKAGES_DIR)

    def emit(msg: str) -> None:
        level = logging.ERROR if "[ERR]" in msg else logging.WARNING if "[WARN]" in msg else logging.INFO
        logger.log(level, "[%s] %s", sync_id, msg)
        if log:
            log(msg)

    results: list[dict] = []
    summary = {"copy": 0, "remove": 0, "skip": 0, "error": 0}
    try:
        cfg = config_mod.load_config() if cfg is None else cfg
        libs = _libs_dir(cfg)
        logger.info("[%s] target=%s", sync_id, libs)
        packages = load_packages()
        managed = {p["file"]: p for p in packages}

        for p in packages:
            item = {
                "id": p["id"], "label": p["label"], "file": p["file"],
                "type": p["type"], "action": "skip", "message": "",
            }
            src = Path(PACKAGES_DIR) / p["file"]
            dst = Path(libs) / p["file"]
            try:
                recovered = False
                # Preserve the SDK's only copy before a disabled dependency is removed.
                if not p.get("custom") and not src.exists() and _usable(dst):
                    _cache_sdk_file(dst, src)
                    recovered = True
                    emit(f"[{_now()}] [OK]   从当前离线 SDK 恢复 {p['label']} 到 {src}")
                if not p["enabled"]:
                    if os.path.exists(dst):
                        os.remove(dst)
                        item["action"] = "remove"
                        item["message"] = f"未勾选，已从 libs 移除: {p['file']}"
                        emit(f"[{_now()}] [WARN] 移除 {p['label']} ({p['file']})")
                    else:
                        item["message"] = f"未勾选，libs 中无此文件"
                    summary["remove" if item["action"] == "remove" else "skip"] += 1
                else:
                    if not _usable(src):
                        item["action"] = "error"
                        item["message"] = f"源文件缺失: {src}；当前离线 SDK 的 simpleDemo/libs 也无可用文件。请补齐匹配当前 SDK 的依赖" + ("，或在依赖包页取消勾选此可选模块" if not p["required"] else "")
                        emit(f"[{_now()}] [ERR] {p['label']} 源文件缺失: {src}")
                        summary["error"] += 1
                    elif _same_file_content(src, dst):
                        item["message"] = "已从当前 SDK 恢复源文件，保留工程依赖" if recovered else "内容一致，跳过"
                        summary["skip"] += 1
                        emit(f"[{_now()}] [INFO] {p['label']} 已是最新")
                    else:
                        shutil.copy2(src, dst)
                        item["action"] = "copy"
                        item["message"] = f"已同步到 simpleDemo/libs: {p['file']}"
                        emit(f"[{_now()}] [OK]   同步 {p['label']} ({p['file']})")
                        summary["copy"] += 1
            except OSError as e:
                logger.exception("[%s] 文件操作失败 source=%s target=%s", sync_id, src, dst)
                item["action"] = "error"
                item["message"] = f"同步失败: {e}"
                emit(f"[{_now()}] [ERR] {p['label']} 同步失败: {e}")
                summary["error"] += 1
            results.append(item)

        # 提示清单外残留文件（不做删除，仅提醒人工核查）
        extra = [f for f in os.listdir(libs)
                 if f not in managed and os.path.isfile(os.path.join(libs, f))]
        if extra:
            emit(f"[{_now()}] [INFO] libs 内存在清单外文件（未处理，保留）: {', '.join(extra)}")
    except Exception as e:
        emit(f"[{_now()}] [ERR] 依赖包同步中断: {e}")
        logger.exception("[%s] 同步中断", sync_id)
        return False, results, {**summary, "error": summary["error"] + 1, "message": str(e)}

    ok = summary["error"] == 0
    logger.info("[%s] 同步结束 ok=%s summary=%s", sync_id, ok, summary)
    return ok, results, summary
