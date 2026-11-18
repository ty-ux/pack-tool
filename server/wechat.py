"""为 uni-app 和原生微信小程序准备本地构建与微信 CI 任务。"""

import json
import os
import re
import shutil
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from .local_tools import executable_name
from .paths import LOGS_DIR, SCRIPTS_DIR
from .project_builds import tool_command

NATIVE_TYPE = "wechat-miniprogram"
PLATFORM = "mp-weixin"
ACTION_LABELS = {"compile": "编译微信小程序", "preview": "生成微信预览二维码", "upload": "上传微信开发版本"}
APPID_RE = re.compile(r"wx[0-9a-fA-F]{16}")
RECEIPT_RE = re.compile(r"[0-9a-f]{32}")


def _json_object(file: Path) -> dict:
    try:
        value = json.loads(file.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        raise ValueError(f"无法读取项目信息：{file}") from None
    if not isinstance(value, dict):
        raise ValueError(f"项目配置应为 JSON 对象：{file}")
    return value


def _node(paths: dict, env: dict[str, str]) -> Path:
    directory = str(paths.get("nodeDir") or "").strip()
    cli = str(Path(directory).expanduser() / executable_name("node")) if directory else shutil.which(executable_name("node"))
    if not cli or not Path(cli).is_file():
        raise ValueError("找不到 Node.js，请在「路径配置」选择 Node.js 目录或配置 PATH")
    node = Path(cli).absolute()
    env["PATH"] = os.pathsep.join(filter(None, (str(node.parent), env.get("PATH"))))
    return node


def _project_config(project: Path) -> dict:
    config = _json_object(project / "project.config.json")
    relative = Path(str(config.get("miniprogramRoot") or "."))
    root = (project / relative).resolve()
    if relative.is_absolute() or not root.is_relative_to(project) or not (root / "app.json").is_file():
        raise ValueError("project.config.json 指定的小程序目录应在项目内，并包含 app.json")
    return config


def preview_file(profile: str, receipt: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{8}", profile) or not RECEIPT_RE.fullmatch(receipt):
        raise ValueError("预览编号无效")
    return LOGS_DIR / "wechat" / profile / f"preview-{receipt}.jpg"


@dataclass
class MiniProgramBuild:
    working_dir: Path
    executable: Path
    args: list[str]
    env: dict[str, str]
    action: str
    artifact_root: Path
    profile: str
    started_ns: int = 0
    artifact: Path | None = None
    receipt: str = ""

    @property
    def command(self) -> list[str]:
        return tool_command(self.executable, self.args)

    @property
    def description(self) -> str:
        return ACTION_LABELS[self.action]

    def collect(self) -> Path | None:
        if self.started_ns:
            _project_config(self.artifact_root)
            if not any(file.stat().st_mtime_ns >= self.started_ns
                       for file in self.artifact_root.rglob("*") if file.is_file()):
                raise ValueError(f"没有发现本次生成的微信小程序产物：{self.artifact_root}")
            return self.artifact_root
        if self.artifact is None:
            return None
        if not self.artifact.is_file() or self.artifact.stat().st_size == 0:
            raise ValueError("微信工具没有生成预期的产物")
        if self.receipt:
            for previous in self.artifact.parent.glob("preview-*.jpg"):
                if previous != self.artifact and RECEIPT_RE.fullmatch(previous.stem.removeprefix("preview-")):
                    try:
                        previous.unlink()
                    except OSError:
                        continue
        return self.artifact


def prepare_wechat_build(cfg: dict, action: str, profile: str) -> MiniProgramBuild:
    if action not in ACTION_LABELS or cfg["projectType"] not in ("uniapp", NATIVE_TYPE):
        raise ValueError("当前工程类型不支持此微信小程序操作")
    if profile and not re.fullmatch(r"[0-9a-f]{8}", profile):
        raise ValueError("应用档案编号无效")
    paths = cfg["paths"]
    raw_project = str(paths.get("projectDir") or "").strip()
    project = Path(raw_project).expanduser().resolve()
    if not raw_project or not project.is_dir():
        raise ValueError("请选择存在的项目根目录")

    env = os.environ.copy()
    wechat = cfg["wechat"]
    appid = str(wechat.get("appid") or "").strip()
    if appid and not APPID_RE.fullmatch(appid):
        raise ValueError("微信小程序 AppID 应为 wx 开头的 18 位标识")
    native = cfg["projectType"] == NATIVE_TYPE
    wechat_project = project
    if not native:
        package = project / "package.json"
        scripts = _json_object(package).get("scripts", {}) if package.is_file() else {}
        npm_build = isinstance(scripts, dict) and "build:mp-weixin" in scripts
        wechat_project = project / ("dist/build/mp-weixin" if npm_build else "unpackage/dist/build/mp-weixin")
        if action == "compile":
            if npm_build:
                node = _node(paths, env)
                npm_js = node.parent / "node_modules/npm/bin/npm-cli.js"
                if npm_js.is_file():
                    executable, args = node, [str(npm_js), "run", "build:mp-weixin"]
                else:
                    npm = shutil.which("npm", path=env["PATH"])
                    if not npm:
                        raise ValueError("找不到 npm，请安装带 npm 的 Node.js 发行版")
                    executable, args = Path(npm), ["run", "build:mp-weixin"]
            else:
                if not (project / "manifest.json").is_file():
                    raise ValueError("请选择含 manifest.json 的 HBuilderX 工程，或提供 build:mp-weixin npm 脚本")
                hbuilder = str(paths.get("hbuilderxCli") or "").strip()
                executable = Path(hbuilder).expanduser().resolve()
                if not hbuilder or not executable.is_file():
                    raise ValueError("请选择 HBuilderX CLI，或使用提供 build:mp-weixin 脚本的 uni-app CLI 工程")
                args = ["publish", "mp-weixin", "--project", str(project), "--upload", "false"]
                if appid:
                    args += ["--appid", appid]
            return MiniProgramBuild(project, executable, args, env, action, wechat_project, profile, time.time_ns())
        if not (wechat_project / "project.config.json").is_file():
            raise ValueError("请先编译生成微信小程序产物")

    project_config = _project_config(wechat_project.resolve())
    project_appid = str(project_config.get("appid") or "").strip()
    appid = appid or project_appid
    if not APPID_RE.fullmatch(appid):
        raise ValueError("请填写微信小程序 AppID，或在 project.config.json 中配置")
    if APPID_RE.fullmatch(project_appid) and project_appid != appid:
        raise ValueError("设置的微信 AppID 与小程序产物中的 AppID 不一致，请核对配置或重新编译")
    key_path = str(wechat.get("privateKeyPath") or "").strip()
    key = Path(key_path).expanduser().resolve()
    if not key_path or not key.is_file():
        raise ValueError("请在「打包构建」选择微信小程序代码上传密钥")
    if key.is_relative_to(project) or key.is_relative_to(wechat_project.resolve()):
        raise ValueError("请选择位于项目和小程序产物目录之外的密钥文件")
    version = str(wechat.get("version") or "").strip()
    if action in ("compile", "upload") and not version:
        raise ValueError("请填写微信小程序版本")

    receipt = uuid.uuid4().hex if action == "preview" else ""
    artifact = preview_file(profile, receipt) if receipt else None
    if action == "compile":
        artifact = LOGS_DIR / "wechat" / profile / "compiled.zip"
    node = _node(paths, env)
    runner = SCRIPTS_DIR / "wechat-ci.cjs"
    env["PACK_TOOL_WECHAT_JOB"] = json.dumps({
        "action": action,
        "projectPath": str(wechat_project),
        "appid": appid,
        "privateKeyPath": str(key),
        "version": version,
        "description": str(wechat.get("description") or "").strip(),
        "artifact": str(artifact) if artifact else "",
    })
    return MiniProgramBuild(project, node, [str(runner)], env, action, wechat_project, profile, artifact=artifact, receipt=receipt)
