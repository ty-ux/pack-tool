import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from server.local_tools import discover_tools, executable_name


class LocalToolDiscoveryTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="packtool tools ")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()

    def add_file(self, relative: str) -> Path:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()
        return path

    def test_discovers_multiple_valid_paths_and_deduplicates_shared_sources(self):
        jdk = self.root / "JDK 21"
        for name in ("java", "javac"):
            self.add_file(f"JDK 21/bin/{executable_name(name)}")
            self.add_file(f"jdk17/bin/{executable_name(name)}")
        flutter = self.add_file("Flutter SDK/bin/" + ("flutter.bat" if os.name == "nt" else "flutter"))
        sdk = self.root / "Android"
        (sdk / "platforms").mkdir(parents=True)
        adb = self.add_file(f"Android/platform-tools/{executable_name('adb')}")
        node = self.add_file(f"Node/{executable_name('node')}")
        cli = self.add_file("HBuilderX/cli.exe")
        self.add_file("HBuilderX/HBuilderX.exe")
        path = os.pathsep.join(str(directory) for directory in (
            jdk / "bin", self.root / "jdk17/bin", flutter.parent, adb.parent, node.parent, cli.parent,
        ))

        tools = discover_tools({
            "TOOL_ROOT": str(self.root), "JAVA_HOME": '"%TOOL_ROOT%/JDK 21"',
            "ANDROID_HOME": str(sdk), "FLUTTER_ROOT": str(flutter.parent.parent), "Path": path,
            "OTHER_SECRET": "never returned",
        })

        self.assertEqual(tools["javaHome"], [
            {"path": str(jdk), "source": "JAVA_HOME"},
            {"path": str(self.root / "jdk17"), "source": "PATH"},
        ])
        self.assertEqual(tools["androidSdk"], [{"path": str(sdk), "source": "ANDROID_HOME"}])
        self.assertEqual(tools["adb"], [{"path": str(adb), "source": "ANDROID_HOME"}])
        self.assertEqual(tools["flutterCli"], [{"path": str(flutter), "source": "FLUTTER_ROOT"}])
        self.assertEqual(tools["nodeDir"], [{"path": str(node.parent), "source": "PATH"}])
        self.assertEqual(tools["hbuilderxCli"], [{"path": str(cli), "source": "PATH"}])

    def test_ignores_incomplete_locations_and_checks_default_sdk(self):
        self.add_file(f"Java Runtime/bin/{executable_name('java')}")
        self.add_file("Other/cli.exe")
        isolated_adb = self.add_file(f"platform-tools/{executable_name('adb')}")
        sdk = self.root / "LocalAppData/Android/Sdk"
        (sdk / "build-tools").mkdir(parents=True)
        tools = discover_tools({
            "JAVA_HOME": str(self.root / "Java Runtime"),
            "ANDROID_SDK_ROOT": str(self.root / "missing"),
            "LOCALAPPDATA": str(self.root / "LocalAppData"),
            "PATH": os.pathsep.join((str(self.root / "Other"), str(isolated_adb.parent))),
        })
        self.assertEqual(tools["javaHome"], [])
        self.assertEqual(tools["hbuilderxCli"], [])
        self.assertEqual(tools["androidSdk"], [{"path": str(sdk), "source": "默认位置"}])
        self.assertEqual(tools["adb"], [{"path": str(isolated_adb), "source": "PATH"}])

    def test_rescan_includes_saved_windows_variables(self):
        for name in ("java", "javac"):
            self.add_file(f"jdk17/bin/{executable_name(name)}")
        saved = {"TOOLS_HOME": str(self.root), "JAVA17_HOME": "%TOOLS_HOME%/jdk17"}
        with patch("server.local_tools.os.environ", {}), patch("server.local_tools._windows_environments", return_value=[saved]):
            tools = discover_tools()
        self.assertEqual(tools["javaHome"], [{"path": str(self.root / "jdk17"), "source": "JAVA17_HOME"}])
