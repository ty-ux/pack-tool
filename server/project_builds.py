"""使用项目自带的 Gradle Wrapper 或 Flutter CLI 构建 Android 产物。"""

import base64
import json
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path


ANDROID_FORMATS = ("apk", "aab")
PROJECT_LABELS = {"android": "原生 Android", "flutter": "Flutter", "react-native": "React Native"}


@dataclass
class ProjectBuild:
    working_dir: Path
    executable: Path
    args: list[str]
    env: dict[str, str]
    output: Path | None
    artifact_root: Path
    variant: str
    flavor: str
    build_type: str
    platform: str
    project_type: str

    @property
    def command(self) -> list[str]:
        argv = [str(self.executable), *self.args]
        if os.name != "nt" or self.executable.suffix.lower() not in (".bat", ".cmd"):
            return argv
        # Native argument arrays in Windows PowerShell handle spaces in batch paths.
        call = "& " + " ".join("'" + arg.replace("'", "''") + "'" for arg in argv)
        script = "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\n" + call + "\nexit $LASTEXITCODE"
        encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
        return ["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded]

    @property
    def description(self) -> str:
        return f"{PROJECT_LABELS[self.project_type]} {self.platform.upper()} ({self.variant})"

    def collect(self) -> Path:
        if self.project_type == "flutter" and self.platform == "apk":
            suffix = f"{self.flavor.lower()}-" if self.flavor else ""
            artifacts = [self.artifact_root / f"app-{suffix}{self.build_type}.apk"]
        elif self.platform == "aab":
            artifacts = sorted((self.artifact_root / self.variant).glob("*.aab"))
        else:
            artifacts = self._gradle_apks()
        artifacts = list(dict.fromkeys(path for path in artifacts if path.is_file() and path.stat().st_size))
        if not artifacts:
            raise ValueError(f"构建命令已完成，但未找到 {self.variant} 的 {self.platform.upper()} 产物：{self.artifact_root}")
        if self.output:
            if len({path.name.casefold() for path in artifacts}) != len(artifacts):
                raise ValueError("构建产物存在重名文件，请清空导出目录设置，直接使用项目产物")
            self.output.mkdir(parents=True, exist_ok=True)
            copied = []
            for path in artifacts:
                target = self.output / path.name
                if path.resolve() != target.resolve():
                    shutil.copy2(path, target)
                copied.append(target)
            artifacts = copied
        return artifacts[0] if len(artifacts) == 1 else Path(os.path.commonpath([path.parent for path in artifacts]))

    def _gradle_apks(self) -> list[Path]:
        artifacts = []
        found_variant = False
        for metadata in self.artifact_root.rglob("output-metadata.json"):
            try:
                data = json.loads(metadata.read_text(encoding="utf-8-sig"))
                if data["variantName"].casefold() != self.variant.casefold():
                    continue
                found_variant = True
                for entry in data["elements"]:
                    name = entry["outputFile"]
                    path = metadata.parent / name
                    if path.suffix.lower() == ".apk" and path.resolve().is_relative_to(metadata.parent.resolve()):
                        artifacts.append(path)
            except (OSError, ValueError, KeyError, TypeError, AttributeError):
                continue
        if found_variant:
            return artifacts
        variant_dir = self.artifact_root / self.flavor / self.build_type
        return sorted(variant_dir.glob("*.apk"))


def prepare_project_build(cfg: dict, platform: str, build_type: str) -> ProjectBuild:
    if platform not in ANDROID_FORMATS or build_type not in ("debug", "release"):
        raise ValueError("请选择有效的 Android 产物和构建模式")
    paths = cfg["paths"]
    raw_project = str(paths.get("projectDir") or "").strip()
    project = Path(raw_project).expanduser().resolve()
    if not raw_project or not project.is_dir():
        raise ValueError("请选择存在的项目根目录")

    env = os.environ.copy()
    java_home = str(paths.get("javaHome") or "").strip()
    if java_home:
        jdk = Path(java_home).expanduser().resolve()
        if not (jdk / "bin" / ("java.exe" if os.name == "nt" else "java")).is_file():
            raise ValueError(f"JDK 路径下找不到 Java：{jdk}")
        env["JAVA_HOME"] = str(jdk)

    settings = cfg["projectBuild"]
    flavor = str(settings.get("flavor") or "").strip()
    if flavor and not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", flavor):
        raise ValueError("Flavor 必须以字母开头，仅包含字母、数字或下划线")
    mode = build_type.capitalize()
    variant = flavor + mode if flavor else build_type
    project_type = cfg["projectType"]
    working_dir = project
    if project_type == "flutter":
        if not (project / "pubspec.yaml").is_file() or not (project / "android").is_dir():
            raise ValueError("Flutter 项目目录应包含 pubspec.yaml 和 android/ 目录")
        cli = str(paths.get("flutterCli") or "").strip() or shutil.which("flutter")
        if not cli or not Path(cli).expanduser().is_file():
            raise ValueError("找不到 Flutter CLI，请填写 Flutter SDK 的 bin/flutter.bat 或配置 PATH")
        executable = Path(cli).expanduser().resolve()
        args = ["build", "apk" if platform == "apk" else "appbundle", f"--{build_type}"]
        if flavor:
            args += ["--flavor", flavor]
        artifact_root = project / "build/app/outputs" / ("flutter-apk" if platform == "apk" else "bundle")
    else:
        if project_type == "react-native":
            if not (project / "package.json").is_file() or not (project / "android").is_dir():
                raise ValueError("React Native 项目根目录应包含 package.json 和 android/ 目录")
            working_dir = project / "android"
        executable = working_dir / ("gradlew.bat" if os.name == "nt" else "gradlew")
        if not executable.is_file():
            raise ValueError(f"找不到 Gradle Wrapper：{executable}")
        module = str(settings.get("gradleModule") or "app").strip().removeprefix(":")
        if not re.fullmatch(r"[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*", module):
            raise ValueError("Gradle 模块应使用 app 或 feature:app 这样的模块路径")
        task_suffix = flavor[:1].upper() + flavor[1:] + mode
        task = ("assemble" if platform == "apk" else "bundle") + task_suffix
        args = [f":{module}:{task}", "--no-daemon", "--console=plain"]
        if project_type == "react-native" and build_type == "release":
            # React Native's release bundling requires Gradle to configure its JS tasks.
            args.append("--no-configure-on-demand")
        artifact_root = working_dir.joinpath(*module.split(":"), "build", "outputs", "apk" if platform == "apk" else "bundle")

    raw_output = str(paths.get("outputDir") or "").strip()
    return ProjectBuild(
        working_dir, executable, args, env, Path(raw_output).expanduser().resolve() if raw_output else None,
        artifact_root, variant, flavor, build_type, platform, project_type,
    )
