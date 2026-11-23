"""构建前检查：只读扫描配置、路径与 Android 离线工程，提前暴露会导致构建失败或合规风险的问题。"""
import os
import re
import shutil
from copy import deepcopy

from . import adb as adb_mod
from . import config as config_mod
from . import packages as packages_mod
from .local_tools import android_sdk_environment
from .project_builds import PROJECT_LABELS, prepare_project_build
from .signing import signing_error
from .wechat import NATIVE_TYPE, PLATFORM as WECHAT_PLATFORM, prepare_wechat_build

PACKAGE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$")
DRAWABLE_ICON_DIRS = (
    "drawable-xxhdpi", "drawable-xhdpi", "drawable-hdpi",
    "drawable-mdpi", "drawable-ldpi", "drawable",
)


def _read(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


def _exists(path: str) -> bool:
    return bool(path) and os.path.exists(path)


def _gradle_value(text: str, key: str) -> str:
    m = re.search(rf"{key}\s+['\"]?([^'\"\s]+)['\"]?", text)
    return m.group(1) if m else ""


def _project_preflight(cfg: dict) -> dict:
    group = PROJECT_LABELS[cfg["projectType"]]
    checks = []
    try:
        build = cfg["build"]
        plan = prepare_project_build(cfg, build["platform"], build["buildType"])
        checks.append({"id": "build-command", "group": group, "label": "构建命令", "status": "ok",
                       "detail": f"{plan.executable} {' '.join(plan.args)}"})
        checks.append({"id": "artifact-root", "group": group, "label": "产物目录", "status": "ok",
                       "detail": str(plan.output or plan.artifact_root)})
        selected_signing = cfg["projectType"] == "flutter" and bool(str(cfg["signing"].get("keystorePath") or "").strip())
        if selected_signing:
            checks.append({"id": "selected-signing", "group": group, "label": "所选签名", "status": "ok",
                           "detail": "使用当前应用选择的签名文件和密码。首次使用独立 Gradle 缓存时需要下载依赖。"})
        elif plan.build_type == "release":
            checks.append({"id": "project-signing", "group": group, "label": "发行签名", "status": "warn",
                           "detail": "发行版沿用项目自身的 Gradle 签名配置，请确认密钥和构建变体。"})
    except (ValueError, OSError) as error:
        checks.append({"id": "project-config", "group": group, "label": "构建配置", "status": "error",
                       "detail": str(error)})
    summary = {status: sum(check["status"] == status for check in checks) for status in ("ok", "warn", "error")}
    return {"ok": True, "checks": checks, "summary": summary}


def run_preflight(draft: dict | None = None) -> dict:
    cfg = config_mod.load_config() if draft is None else deepcopy(config_mod.DEFAULT_CONFIG)
    if draft is not None:
        config_mod.deep_merge(cfg, draft)
    if cfg["projectType"] == NATIVE_TYPE or cfg["build"]["platform"] == WECHAT_PLATFORM:
        try:
            plan = prepare_wechat_build(cfg, "compile", "")
            status, detail = "ok", str(plan.artifact or plan.artifact_root)
        except (ValueError, OSError) as error:
            status, detail = "error", str(error)
        check = {"id": "wechat-build", "group": "微信小程序", "label": "编译配置", "status": status, "detail": detail}
        return {"ok": True, "checks": [check], "summary": {"ok": int(status == "ok"), "warn": 0, "error": int(status == "error")}}
    if cfg["projectType"] in PROJECT_LABELS:
        return _project_preflight(cfg)
    app = cfg.get("app") or {}
    android = cfg.get("android") or {}
    paths = cfg.get("paths") or {}
    build = cfg.get("build") or {}
    install = cfg.get("install") or {}

    checks: list[dict] = []

    def add(cid: str, group: str, label: str, status: str, detail: str) -> None:
        checks.append({"id": cid, "group": group, "label": label, "status": status, "detail": detail})

    # ---------------- 应用信息 ----------------
    name = str(app.get("name") or "").strip()
    add(
        "app-name", "应用信息", "App 名称",
        "ok" if name else "error",
        name or "未填写 App 名称，构建会写入空的应用名",
    )

    appid = str(app.get("appid") or "").strip()
    if not appid:
        add("appid", "应用信息", "AppID", "error", "未填写 AppID，无法定位 HBuilderX 编译产物")
    elif not appid.startswith("__UNI__"):
        add("appid", "应用信息", "AppID", "warn", f"{appid}：HBuilderX 的 AppID 通常以 __UNI__ 开头，请确认")
    else:
        add("appid", "应用信息", "AppID", "ok", appid)

    package = str(android.get("packageName") or "").strip()
    if not package:
        add("package", "应用信息", "包名", "error", "未填写 Android 包名")
    elif not PACKAGE_RE.match(package):
        add("package", "应用信息", "包名", "error", f"{package}：包名不合法，应为 com.example.app 形式")
    else:
        add("package", "应用信息", "包名", "ok", f"{package}（构建时写入 applicationId 与 namespace）")

    version_name = str(app.get("versionName") or "").strip()
    version_code = str(app.get("versionCode") or "").strip()
    if not version_name:
        add("version", "应用信息", "版本号", "error", "未填写 versionName")
    elif not version_code.isdigit() or int(version_code) < 1:
        add("version", "应用信息", "版本号", "error", "versionCode 必须是大于 0 的整数")
    else:
        add("version", "应用信息", "版本号", "ok", f"v{version_name}（{version_code}）")

    icon = str(app.get("icon") or "").strip()
    integrate_dir = str(paths.get("integrateDir") or "").strip()
    simple_main = os.path.join(integrate_dir, "simpleDemo", "src", "main") if integrate_dir else ""
    res_dir = os.path.join(simple_main, "res") if simple_main else ""
    icon_targets = []
    if os.path.isdir(res_dir):
        icon_targets = sorted(
            e.name for e in os.scandir(res_dir)
            if e.is_dir() and e.name.startswith("drawable") and os.path.isfile(os.path.join(e.path, "icon.png"))
        )
    manifest = os.path.join(simple_main, "AndroidManifest.xml") if simple_main else ""
    m_icon = re.search(r'android:icon\s*=\s*"([^"]+)"', _read(manifest))
    manifest_icon = m_icon.group(1) if m_icon else ""
    decodable = (".png", ".jpg", ".jpeg", ".bmp", ".gif", ".tif", ".tiff")
    if not icon:
        add("icon", "应用信息", "应用图标", "ok", "未设置自定义图标，构建时沿用工程 res 中现有的 icon.png")
    elif os.path.isdir(icon):
        folder_sources = []
        if os.path.isfile(os.path.join(icon, "icon.png")):
            folder_sources.append("icon.png")
        folder_sources += [
            name for name in DRAWABLE_ICON_DIRS
            if os.path.isfile(os.path.join(icon, name, "icon.png"))
        ]
        if not folder_sources:
            add(
                "icon", "应用信息", "应用图标", "warn",
                f"{icon}：目录中没有 icon.png 或 drawable*/icon.png，构建会跳过自定义图标，APK 沿用工程默认图标。",
            )
        elif manifest_icon and manifest_icon != "@drawable/icon":
            add(
                "icon", "应用信息", "应用图标", "warn",
                f"{icon}：构建会按 dpi 写入 drawable*/icon.png，但 AndroidManifest 的 android:icon 指向 {manifest_icon}，APK 图标不会变化。",
            )
        else:
            add(
                "icon", "应用信息", "应用图标", "ok",
                f"{icon}：按 dpi 使用目录内 {len(folder_sources)} 个源图标（{'、'.join(folder_sources)}），"
                "原图标首次覆盖前备份到 simpleDemo\\.pack-tool\\icon-backup",
            )
    elif not os.path.isfile(icon):
        add(
            "icon", "应用信息", "应用图标", "warn",
            f"图标路径不存在：{icon}。构建会跳过自定义图标，APK 沿用工程默认图标，请重新选择。",
        )
    elif os.path.splitext(icon)[1].lower() not in decodable:
        add(
            "icon", "应用信息", "应用图标", "warn",
            f"{icon}：该格式无法转换为 PNG（webp 等），构建会跳过自定义图标，请改用 PNG。",
        )
    elif manifest_icon and manifest_icon != "@drawable/icon":
        add(
            "icon", "应用信息", "应用图标", "warn",
            f"{icon}：构建会写入 drawable*/icon.png，但 AndroidManifest 的 android:icon 指向 {manifest_icon}，APK 图标不会变化。",
        )
    elif icon_targets:
        add(
            "icon", "应用信息", "应用图标", "ok",
            f"{icon}：构建时覆盖 {len(icon_targets)} 个 drawable 目录的 icon.png（{'、'.join(icon_targets)}），"
            "原图标首次覆盖前备份到 simpleDemo\\.pack-tool\\icon-backup",
        )
    else:
        add(
            "icon", "应用信息", "应用图标", "warn",
            f"{icon}：工程 res 中没有 icon.png，构建时会创建 res\\drawable\\icon.png；请确认 AndroidManifest 引用的是 @drawable/icon。",
        )

    # ---------------- 环境与路径 ----------------
    hbx = str(paths.get("hbuilderxCli") or "").strip()
    if not hbx:
        add("hbuilderx", "环境与路径", "HBuilderX CLI", "error", "未配置 HBuilderX CLI 路径")
    elif not os.path.isfile(hbx):
        add("hbuilderx", "环境与路径", "HBuilderX CLI", "error", f"文件不存在：{hbx}")
    else:
        add("hbuilderx", "环境与路径", "HBuilderX CLI", "ok", hbx)

    project = str(paths.get("projectDir") or "").strip()
    if not project or not os.path.isdir(project):
        add("project", "环境与路径", "uni-app 项目目录", "error", f"目录不存在：{project or '未配置'}")
    elif not os.path.isfile(os.path.join(project, "manifest.json")):
        add("project", "环境与路径", "uni-app 项目目录", "error", f"{project} 下没有 manifest.json，可能不是 HBuilderX 项目")
    else:
        add("project", "环境与路径", "uni-app 项目目录", "ok", project)

    integrate = str(paths.get("integrateDir") or "").strip()
    simple_demo = os.path.join(integrate, "simpleDemo") if integrate else ""
    if not integrate or not os.path.isdir(integrate):
        add("integrate", "环境与路径", "离线打包工程", "error", f"目录不存在：{integrate or '未配置'}")
    elif not os.path.isdir(simple_demo):
        add("integrate", "环境与路径", "离线打包工程", "error", f"{integrate} 下没有 simpleDemo 模块")
    else:
        add("integrate", "环境与路径", "离线打包工程", "ok", integrate)

    gradlew = os.path.join(integrate, "gradlew.bat") if integrate else ""
    add(
        "gradlew", "环境与路径", "Gradle Wrapper",
        "ok" if os.path.isfile(gradlew) else "error",
        gradlew if os.path.isfile(gradlew) else f"找不到 gradlew.bat：{gradlew or '离线工程未配置'}",
    )

    java_home = str(paths.get("javaHome") or "").strip() or os.environ.get("JAVA_HOME", "").strip('"')
    java = os.path.join(java_home, "bin", "java.exe") if java_home else shutil.which("java")
    if java_home and not os.path.isfile(java):
        add("java", "环境与路径", "JDK", "error", f"JAVA_HOME 未指向有效的 JDK：{java_home}")
    elif not java:
        add("java", "环境与路径", "JDK", "error", "请配置 JDK 路径、设置 JAVA_HOME 或将 java 加入 PATH")
    else:
        add("java", "环境与路径", "JDK", "ok", java)

    if cfg["build"].get("platform") == "apk" and paths.get("androidSdk"):
        try:
            sdk_env = android_sdk_environment(paths)
            if sdk_env:
                add("android-sdk", "环境与路径", "Android SDK", "ok", sdk_env["ANDROID_HOME"])
        except (ValueError, OSError) as error:
            add("android-sdk", "环境与路径", "Android SDK", "error", str(error))

    if install.get("enabled"):
        adb = adb_mod.find_adb(str(paths.get("adb") or "").strip(), str(paths.get("androidSdk") or "").strip())
        if not adb:
            add("adb", "环境与路径", "adb", "error", "已启用自动安装，但找不到 adb，请配置 adb 路径")
        elif not install.get("serial"):
            add("adb", "环境与路径", "adb", "warn", "已启用自动安装，但没有选择目标设备")
        else:
            add("adb", "环境与路径", "adb", "ok", f"{adb}（目标设备 {install.get('serial')}）")
    else:
        add("adb", "环境与路径", "adb", "ok", "未启用自动安装，跳过设备检查")

    output_dir = str(paths.get("outputDir") or "").strip()
    if not output_dir:
        add("output", "环境与路径", "输出目录", "warn", "未配置输出目录，APK 将留在离线工程的 build/outputs 下")
    elif os.path.isdir(output_dir):
        add("output", "环境与路径", "输出目录", "ok", output_dir)
    elif os.path.isdir(os.path.dirname(output_dir) or output_dir):
        add("output", "环境与路径", "输出目录", "warn", f"目录尚不存在，构建时会自动创建：{output_dir}")
    else:
        add("output", "环境与路径", "输出目录", "warn", f"父目录不存在，请先创建：{output_dir}")

    selected_keystore = str((cfg.get("signing") or {}).get("keystorePath") or "").strip()
    if selected_keystore:
        error = signing_error(cfg)
        add("keystore", "签名与发布", "应用签名", "error" if error else "ok",
            error or f"本次 APK 将使用 {selected_keystore} 中选定的密钥")

    # 依赖包
    try:
        packages = packages_mod.load_packages()
        missing = [
            p["file"] for p in packages
            if p.get("enabled") and not os.path.isfile(os.path.join(packages_mod.PACKAGES_DIR, p["file"]))
        ]
        enabled = sum(1 for p in packages if p.get("enabled"))
        if missing:
            add("packages", "环境与路径", "依赖包", "error", "packages/ 中缺少已启用依赖：" + "、".join(missing))
        else:
            add("packages", "环境与路径", "依赖包", "ok", f"{enabled} 个已启用依赖的源文件齐全")
    except Exception as e:
        add("packages", "环境与路径", "依赖包", "error", f"读取依赖包清单失败：{e}")

    # ---------------- Android 工程 ----------------
    manifest = os.path.join(simple_demo, "src", "main", "AndroidManifest.xml") if simple_demo else ""
    add(
        "manifest", "Android 工程", "AndroidManifest.xml",
        "ok" if os.path.isfile(manifest) else "error",
        manifest if os.path.isfile(manifest) else f"找不到 AndroidManifest.xml：{manifest or '离线工程未配置'}",
    )

    strings = os.path.join(simple_demo, "src", "main", "res", "values", "strings.xml") if simple_demo else ""
    add(
        "strings", "Android 工程", "strings.xml",
        "ok" if os.path.isfile(strings) else "warn",
        strings if os.path.isfile(strings) else "找不到 strings.xml，构建时不会更新桌面显示的应用名",
    )

    gradle_file = os.path.join(simple_demo, "build.gradle") if simple_demo else ""
    gradle_text = _read(gradle_file)
    if not gradle_text:
        add("sdk", "Android 工程", "SDK 版本", "error", f"无法读取 simpleDemo/build.gradle：{gradle_file or '离线工程未配置'}")
    else:
        compile_sdk = _gradle_value(gradle_text, "compileSdkVersion")
        min_sdk = _gradle_value(gradle_text, "minSdkVersion")
        target_sdk = _gradle_value(gradle_text, "targetSdkVersion")
        detail = f"compileSdk {compile_sdk or '?'} · minSdk {min_sdk or '?'} · targetSdk {target_sdk or '?'}"
        if target_sdk.isdigit() and int(target_sdk) < 35:
            add(
                "sdk", "Android 工程", "SDK 版本", "warn",
                detail + "。targetSdk 低于 35：Android 14/15 上会以兼容模式运行；Google Play 新上架与更新要求 35，内部分发不受限。",
            )
        else:
            add("sdk", "Android 工程", "SDK 版本", "ok", detail)

        if not selected_keystore:
            store = re.search(r"storeFile\s+file\(\s*['\"]([^'\"]+)['\"]\s*\)", gradle_text)
            store_path = os.path.join(simple_demo, store.group(1).replace("\\\\", "\\")) if store else ""
            if not store_path:
                add("keystore", "签名与发布", "签名文件", "warn", "未选择应用签名，将沿用离线工程的 Gradle 签名设置")
            elif not os.path.isfile(store_path):
                add("keystore", "签名与发布", "签名文件", "error", f"keystore 不存在：{store_path}")
            else:
                add("keystore", "签名与发布", "签名文件", "ok", store_path)

        if re.search(r"(keyPassword|storePassword)\s+['\"][^'\"]+['\"]", gradle_text):
            add(
                "signing-secret", "签名与发布", "签名口令",
                "warn",
                "签名口令以明文写在 build.gradle。建议移到本机 gradle.properties 或 local.properties，并加入版本控制忽略。",
            )

        release_block = re.search(r"release\s*\{([\s\S]*?)\}", gradle_text)
        release_text = release_block.group(1) if release_block else ""
        if "minifyEnabled false" in release_text:
            add(
                "r8", "签名与发布", "release 代码压缩",
                "warn",
                "release 未开启 R8（minifyEnabled false），APK 体积偏大。开启前需为 DCloud/uni-app 与反射调用的 SDK 补 keep 规则。",
            )
        elif release_text:
            add("r8", "签名与发布", "release 代码压缩", "ok", "release 已开启 R8")
        else:
            add("r8", "签名与发布", "release 代码压缩", "warn", "未找到 release 构建块，请确认 build.gradle 结构")

        if re.search(r"allowBackup\s*=\s*\"true\"", _read(manifest)):
            add(
                "allowbackup", "签名与发布", "allowBackup",
                "warn",
                "AndroidManifest 允许系统备份应用数据。如果应用无需备份，建议设为 false 并配置 dataExtractionRules。",
            )
        else:
            add("allowbackup", "签名与发布", "allowBackup", "ok", "未开启 allowBackup")

    # ---------------- 权限合规 ----------------
    selected = set(android.get("permissions") or [])
    level_meta = {
        "blocked": "仅系统应用可用",
        "deprecated": "已弃用",
        "special": "需系统设置单独授权",
        "sensitive": "应用商店重点关注",
        "scoped": "受 Android 版本限制",
    }
    risky = [
        p for p in config_mod.PERMISSIONS
        if p["key"] in selected and p.get("level") in level_meta
    ]
    if risky:
        detail = "；".join(f"{p['label']}（{level_meta[p['level']]}）" for p in risky)
        add("permissions", "权限合规", "需要留意的权限", "warn", detail)
    else:
        add("permissions", "权限合规", "权限勾选", "ok", "未勾选需要额外处理的高风险权限")

    summary = {s: sum(1 for c in checks if c["status"] == s) for s in ("ok", "warn", "error")}
    return {"ok": True, "checks": checks, "summary": summary}
