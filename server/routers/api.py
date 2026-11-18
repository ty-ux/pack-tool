"""API 路由：与旧版接口契约一致，新增 build/cancel 与 browse"""
import os
import subprocess
from typing import Literal, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .. import adb as adb_mod
from .. import apps as apps_mod
from .. import browse as browse_mod
from .. import config as config_mod
from .. import history as history_mod
from .. import packages as packages_mod
from .. import preflight as preflight_mod
from ..builder import build_manager
from ..paths import BUILD_LOG
from ..project_builds import ANDROID_FORMATS, PROJECT_LABELS

router = APIRouter(prefix="/api")
CREATE_NO_WINDOW = 0x08000000


# ---------------- 请求体 ----------------
class SaveConfigBody(BaseModel):
    config: dict


class CreateAppBody(BaseModel):
    name: Optional[str] = ""
    projectType: Literal["uniapp", "android", "flutter", "react-native"] | None = None


class ActivateAppBody(BaseModel):
    id: str


class AdbRestartBody(BaseModel):
    adb: Optional[str] = ""


class AdbConnectBody(BaseModel):
    hostPort: Optional[str] = ""
    adb: Optional[str] = ""


class BuildBody(BaseModel):
    platform: Optional[str] = None
    webType: Optional[str] = None


class OpenDirBody(BaseModel):
    dir: Optional[str] = ""


class BrowseBody(BaseModel):
    type: str = "dir"
    title: Optional[str] = ""
    fileFilter: Optional[str] = ""


# ---------------- 配置 ----------------
@router.get("/config")
def get_config():
    return {"ok": True, "config": config_mod.load_config()}


@router.post("/config")
def post_config(body: SaveConfigBody):
    if not body.config:
        raise HTTPException(400, "缺少 config")
    config_mod.save_config(body.config)
    return {"ok": True, "config": config_mod.load_config()}


@router.get("/permissions")
def get_permissions():
    return {"ok": True, "permissions": config_mod.PERMISSIONS}


# ---------------- 多应用 ----------------
def _apps_payload() -> dict:
    return {
        "ok": True,
        "active": apps_mod.active_id(),
        "apps": apps_mod.list_apps(),
        "config": config_mod.load_config(),
    }


@router.get("/apps")
def get_apps():
    return _apps_payload()


@router.post("/apps")
def post_app(body: CreateAppBody):
    apps_mod.create_app(body.name or "", body.projectType)
    return _apps_payload()


@router.post("/apps/activate")
def activate_app(body: ActivateAppBody):
    try:
        apps_mod.set_active(body.id)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    return _apps_payload()


@router.delete("/apps/{app_id}")
def delete_app(app_id: str):
    try:
        apps_mod.delete_app(app_id)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return _apps_payload()


ICON_PREVIEW_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif")
ICON_DECODABLE = (".png", ".jpg", ".jpeg", ".bmp", ".gif", ".tif", ".tiff")
DRAWABLE_ICON_DIRS = (
    "drawable-xxhdpi", "drawable-xhdpi", "drawable-hdpi",
    "drawable-mdpi", "drawable-ldpi", "drawable",
)


def _best_icon_in_dir(path: str) -> str:
    """在图标目录里挑一张代表图：优先 xxhdpi，逐级降到 drawable"""
    direct = os.path.join(path, "icon.png")
    if os.path.isfile(direct):
        return direct
    for name in DRAWABLE_ICON_DIRS:
        candidate = os.path.join(path, name, "icon.png")
        if os.path.isfile(candidate):
            return candidate
    return ""


@router.get("/icon")
def get_icon(path: str = ""):
    """本地图标预览：path 可以是图片文件或图标目录（取其中分辨率最高的一张）"""
    p = os.path.abspath(path)
    if os.path.isdir(p):
        p = _best_icon_in_dir(p)
    if not os.path.isfile(p) or os.path.splitext(p)[1].lower() not in ICON_PREVIEW_EXTS:
        raise HTTPException(404, "图标文件不存在或格式不支持")
    return FileResponse(p, headers={"Cache-Control": "no-cache"})


@router.get("/app-icon")
def get_app_icon(icon: Optional[str] = None):
    """打包时实际生效的图标：传入的图标可用就用它，否则回退到离线工程 res 中的 icon.png"""
    cfg = config_mod.load_config()
    custom = str(icon if icon is not None else (cfg.get("app") or {}).get("icon") or "").strip()
    if custom:
        candidate = _best_icon_in_dir(custom) if os.path.isdir(custom) else custom
        if (
            candidate
            and os.path.isfile(candidate)
            and os.path.splitext(candidate)[1].lower() in ICON_DECODABLE
        ):
            return FileResponse(candidate, headers={"Cache-Control": "no-cache"})

    integrate = str((cfg.get("paths") or {}).get("integrateDir") or "").strip()
    res_dir = os.path.join(integrate, "simpleDemo", "src", "main", "res") if integrate else ""
    for name in DRAWABLE_ICON_DIRS:
        candidate = os.path.join(res_dir, name, "icon.png")
        if os.path.isfile(candidate):
            return FileResponse(candidate, headers={"Cache-Control": "no-cache"})
    raise HTTPException(404, "未找到可用的应用图标")


# ---------------- 依赖包管理 ----------------
@router.get("/packages")
def get_packages():
    return {"ok": True, "packages": packages_mod.load_packages()}


class SavePackagesBody(BaseModel):
    packages: list = []


@router.post("/packages")
def post_packages(body: SavePackagesBody):
    items = packages_mod.save_packages(body.packages)
    return {"ok": True, "packages": items}


@router.post("/packages/sync")
def sync_packages():
    ok, results, summary = packages_mod.sync_packages()
    return {"ok": ok, "results": results, "summary": summary}


def _fix_multipart_text(value: str) -> str:
    """python-multipart 把文本字段按 latin-1 解码，UTF-8 中文会变乱码；
    尝试把收到的字符还原成原始 UTF-8 字节再解码，失败则说明本来就是纯文本。"""
    try:
        return value.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value


@router.post("/packages/upload")
def upload_package(file: UploadFile = File(...), label: str = Form(""), desc: str = Form("")):
    """上传自定义依赖包（.aar/.jar），落盘到 packages/ 并写入自定义清单。"""
    try:
        pkg = packages_mod.create_custom_package(
            _fix_multipart_text(file.filename or ""),
            _fix_multipart_text(label),
            _fix_multipart_text(desc),
            file.file,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"上传失败: {e}")
    finally:
        try:
            file.file.close()
        except Exception:
            pass
    return {"ok": True, "package": pkg}


@router.delete("/packages/{pkg_id}")
def delete_package(pkg_id: str):
    """删除自定义依赖包（仅限 custom- 前缀），并清理源文件与 libs 中的对应文件。"""
    try:
        deleted = packages_mod.delete_custom_package(pkg_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"删除失败: {e}")
    return {"ok": True, "deleted": deleted}


# ---------------- adb ----------------
@router.get("/devices")
def get_devices():
    cfg = config_mod.load_config()
    return {"ok": True, "devices": adb_mod.get_devices((cfg.get("paths") or {}).get("adb", ""))}


@router.post("/adb/restart")
def adb_restart(body: AdbRestartBody):
    ok, msg = adb_mod.restart_adb(body.adb)
    if ok:
        return {"ok": True, "message": msg, "devices": adb_mod.get_devices(adb_mod.find_adb() or "")}
    raise HTTPException(500, msg)


@router.post("/adb/connect")
def adb_connect(body: AdbConnectBody):
    ok, msg = adb_mod.adb_connect(body.hostPort, body.adb)
    if ok:
        return {"ok": True, "message": msg, "devices": adb_mod.get_devices(adb_mod.find_adb() or "")}
    raise HTTPException(500, msg)


# ---------------- 构建 ----------------
@router.get("/status")
def get_status():
    return {"ok": True, **build_manager.status()}


@router.get("/preflight")
def preflight():
    """构建前检查：只读，不修改任何配置或工程文件"""
    return preflight_mod.run_preflight()


@router.post("/preflight")
def preflight_draft(body: SaveConfigBody):
    return preflight_mod.run_preflight(body.config)


@router.get("/logs")
def get_logs():
    if BUILD_LOG.exists():
        raw = BUILD_LOG.read_bytes()
        try:
            content = raw.decode("utf-8")
        except UnicodeDecodeError:
            content = raw.decode("gbk", errors="replace")
        return {"ok": True, "log": content[-20000:]}
    return {"ok": True, "log": ""}


@router.post("/build")
def start_build(body: BuildBody):
    cfg = config_mod.load_config()

    formats = ANDROID_FORMATS if cfg["projectType"] in PROJECT_LABELS else ("apk", "web", "wgt")
    requested = (body.platform or "").strip().lower()
    if requested and requested not in formats:
        raise HTTPException(400, "当前工程类型不支持此构建目标")
    saved = cfg["build"].get("platform")
    platform = requested or (saved if saved in formats else "apk")

    if platform == "web":
        web_type = (body.webType or "").strip().lower()
        if web_type not in ("pc", "h5"):
            web_type = (cfg.get("build", {}).get("webType") or "h5") or "h5"
        if web_type not in ("pc", "h5"):
            web_type = "h5"
    else:
        web_type = "h5"

    build_type = (cfg.get("build", {}).get("buildType") or "debug") or "debug"
    if build_type not in ("debug", "release"):
        build_type = "debug"

    ok, msg = build_manager.start(platform, web_type, build_type)
    if not ok:
        raise HTTPException(400, msg)
    return {"ok": True, "message": msg}


@router.post("/build/cancel")
def cancel_build():
    ok, msg = build_manager.cancel()
    if not ok:
        raise HTTPException(400, msg)
    return {"ok": True, "message": msg}


# ---------------- 其他 ----------------
@router.post("/open-dir")
def open_dir(body: OpenDirBody):
    d = (body.dir or "").strip()
    # 兼容目录与文件（文件会在资源管理器中定位到所在目录）
    if not d or (not os.path.isdir(d) and not os.path.isfile(d)):
        raise HTTPException(400, f"路径不存在: {d}")
    try:
        subprocess.Popen(
            ["explorer", os.path.normpath(d)],
            creationflags=CREATE_NO_WINDOW,
        )
        return {"ok": True, "message": f"已打开: {d}"}
    except Exception as e:
        raise HTTPException(500, f"打开目录失败: {e}")


@router.post("/browse")
def browse(body: BrowseBody):
    result = browse_mod.browse(kind=body.type, title=body.title, file_filter=body.fileFilter)
    if result.get("ok"):
        return result
    if result.get("cancelled"):
        return {"ok": False, "cancelled": True, "path": ""}
    raise HTTPException(500, result.get("error", "选择失败"))


# ---------------- 构建历史 ----------------
@router.get("/history")
def get_history(limit: int = 20, platform: str = ""):
    limit = max(1, min(limit, 100))
    return {"ok": True, "builds": history_mod.list_builds(limit=limit, platform=platform)}


@router.post("/history/clear")
def clear_history():
    n = history_mod.clear_all()
    return {"ok": True, "message": f"已清空 {n} 条历史记录"}


@router.get("/history/{build_id}")
def get_history_detail(build_id: int):
    b = history_mod.get_build(build_id)
    if not b:
        raise HTTPException(404, "构建记录不存在")
    return {"ok": True, "build": b}


@router.get("/history/{build_id}/log")
def get_history_log(build_id: int):
    b = history_mod.get_build(build_id)
    if not b:
        raise HTTPException(404, "构建记录不存在")
    return {"ok": True, "log": history_mod.read_archive_log(b.get("log_path") or "")}
