"""发现本机已安装的构建工具，且只返回验证过的工具路径。"""

import os
import re
from pathlib import Path
from typing import Mapping


JAVA_VARIABLE = re.compile(r"(?:JAVA|JDK)(?:_?\d+(?:[_.]\d+)*)?_HOME|STUDIO_JDK")
WINDOWS_VAR = re.compile(r"%([^%]+)%")
TOOL_KEYS = ("javaHome", "androidSdk", "flutterCli", "adb", "hbuilderxCli", "nodeDir")


def executable_name(name: str) -> str:
    return name + ".exe" if os.name == "nt" else name


def is_android_sdk(path: Path) -> bool:
    try:
        return any((path / name).is_dir() for name in ("platforms", "build-tools", "cmdline-tools"))
    except OSError:
        return False


def _is_file(path: Path) -> bool:
    try:
        return path.is_file()
    except OSError:
        return False


def android_sdk_environment(paths: dict) -> dict[str, str]:
    value = str(paths.get("androidSdk") or "").strip()
    if not value:
        return {}
    sdk = Path(value).expanduser().resolve()
    if not is_android_sdk(sdk):
        raise ValueError(f"Android SDK 目录无效，应包含 platforms、build-tools 或 cmdline-tools：{sdk}")
    return {"ANDROID_HOME": str(sdk), "ANDROID_SDK_ROOT": str(sdk)}


def _windows_environments() -> list[dict[str, str]]:
    if os.name != "nt":
        return []
    import winreg

    keys = (
        (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
        (winreg.HKEY_CURRENT_USER, "Environment"),
    )
    result = []
    for hive, subkey in keys:
        try:
            with winreg.OpenKey(hive, subkey) as key:
                entries = {}
                for index in range(winreg.QueryInfoKey(key)[1]):
                    name, value, kind = winreg.EnumValue(key, index)
                    if kind in (winreg.REG_SZ, winreg.REG_EXPAND_SZ) and isinstance(value, str):
                        entries[name.upper()] = value
                result.append(entries)
        except OSError:
            continue
    return result


def _local_path(raw: str, variables: Mapping[str, str]) -> Path | None:
    value = raw.strip().strip('"')
    for _ in range(5):
        expanded = WINDOWS_VAR.sub(lambda match: variables.get(match[1].upper(), match[0]), value)
        if expanded == value:
            break
        value = expanded
    if not value or "\x00" in value or value.startswith(("\\\\", "//")):
        return None
    path = Path(value)
    return path if path.is_absolute() else None


def discover_tools(environment: Mapping[str, str] | None = None) -> dict[str, list[dict[str, str]]]:
    process = {name.upper(): value for name, value in (os.environ if environment is None else environment).items()}
    saved = _windows_environments() if environment is None else []
    live = process.copy()
    for scope in saved:
        live.update(scope)
    sources = [(process, process), *((scope, live) for scope in saved)]
    candidates: dict[str, dict[str, dict[str, str]]] = {name: {} for name in TOOL_KEYS}

    def add(key: str, path: Path, source: str) -> None:
        try:
            resolved = str(path.resolve(strict=True))
        except (OSError, ValueError, RuntimeError):
            return
        candidates[key].setdefault(os.path.normcase(resolved), {"path": resolved, "source": source})

    def java(home: Path, source: str) -> None:
        if all(_is_file(home / "bin" / executable_name(name)) for name in ("java", "javac")):
            add("javaHome", home, source)

    def android(home: Path, source: str) -> None:
        if is_android_sdk(home):
            add("androidSdk", home, source)
        adb = home / "platform-tools" / executable_name("adb")
        if _is_file(adb):
            add("adb", adb, source)

    flutter_command = "flutter.bat" if os.name == "nt" else "flutter"
    for values, expansion in sources:
        for name, raw in values.items():
            if not (JAVA_VARIABLE.fullmatch(name) or name in {
                "ANDROID_HOME", "ANDROID_SDK_ROOT", "FLUTTER_ROOT", "FLUTTER_HOME",
                "HBUILDERX_CLI", "HBUILDERX_HOME", "NODE_HOME", "NVM_SYMLINK",
            }):
                continue
            path = _local_path(raw, expansion)
            if path is None:
                continue
            if JAVA_VARIABLE.fullmatch(name):
                java(path, name)
            elif name in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
                android(path, name)
            elif name.startswith("FLUTTER_") and _is_file(cli := path / "bin" / flutter_command):
                add("flutterCli", cli, name)
            elif name.startswith("HBUILDERX_"):
                cli = path if name == "HBUILDERX_CLI" else path / "cli.exe"
                if _is_file(cli):
                    add("hbuilderxCli", cli, name)
            elif name in ("NODE_HOME", "NVM_SYMLINK") and _is_file(path / executable_name("node")):
                add("nodeDir", path, name)

    checked = set()
    for values, expansion in sources:
        for entry in values.get("PATH", "").split(os.pathsep):
            directory = _local_path(entry, expansion)
            if directory is None or directory in checked:
                continue
            checked.add(directory)
            if _is_file(java_command := directory / executable_name("java")):
                try:
                    java(java_command.resolve(strict=True).parent.parent, "PATH")
                except (OSError, ValueError, RuntimeError):
                    pass
            if _is_file(flutter := directory / flutter_command):
                add("flutterCli", flutter, "PATH")
            if _is_file(adb := directory / executable_name("adb")):
                add("adb", adb, "PATH")
                if directory.name.lower() == "platform-tools" and is_android_sdk(directory.parent):
                    add("androidSdk", directory.parent, "PATH")
            if _is_file(directory / executable_name("node")):
                add("nodeDir", directory, "PATH")
            if _is_file(directory / "HBuilderX.exe") and _is_file(directory / "cli.exe"):
                add("hbuilderxCli", directory / "cli.exe", "PATH")

    if local := _local_path(live.get("LOCALAPPDATA", ""), live):
        android(local / "Android" / "Sdk", "默认位置")
    if program_files := _local_path(live.get("PROGRAMFILES", ""), live):
        java(program_files / "Android" / "Android Studio" / "jbr", "Android Studio")

    return {key: list(paths.values()) for key, paths in candidates.items()}
