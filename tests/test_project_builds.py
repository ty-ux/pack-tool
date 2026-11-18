import json
import os
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

from server.config import DEFAULT_CONFIG
from server.project_builds import prepare_project_build


class ProjectBuildTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="packtool fixture ")
        self.addCleanup(temporary.cleanup)
        self.project = Path(temporary.name)
        self.config = deepcopy(DEFAULT_CONFIG)
        self.config["paths"]["projectDir"] = str(self.project)

    def write(self, path, content="fixture"):
        file = self.project / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content, encoding="utf-8")
        return file

    def android(self):
        self.config["projectType"] = "android"
        self.config["projectBuild"] = {"gradleModule": ":feature:demo", "flavor": "freeChina"}
        self.write("gradlew.bat" if os.name == "nt" else "gradlew")

    def flutter(self):
        self.config["projectType"] = "flutter"
        self.config["projectBuild"]["flavor"] = "demo"
        self.config["paths"]["flutterCli"] = str(self.write("tools/flutter.bat"))
        self.write("pubspec.yaml", "name: demo")
        (self.project / "android").mkdir()

    def test_native_uses_module_and_flavor_with_split_apks(self):
        self.android()
        plan = prepare_project_build(self.config, "apk", "debug")
        self.assertEqual(plan.args[0], ":feature:demo:assembleFreeChinaDebug")
        variant = "feature/demo/build/outputs/apk/free/china/debug/"
        self.write(variant + "output-metadata.json", json.dumps({
            "variantName": "freeChinaDebug",
            "elements": [{"outputFile": "arm.apk"}, {"outputFile": "x64.apk"}],
        }))
        self.write(variant + "arm.apk")
        self.write(variant + "x64.apk")
        self.write("feature/demo/build/outputs/apk/debug/unrelated.apk")
        self.assertEqual(plan.collect(), self.project / variant)

    def test_native_exports_only_selected_bundle(self):
        self.android()
        export = self.project / "export"
        self.config["paths"]["outputDir"] = str(export)
        plan = prepare_project_build(self.config, "aab", "release")
        self.assertEqual(plan.args[0], ":feature:demo:bundleFreeChinaRelease")
        self.write("feature/demo/build/outputs/bundle/release/other.aab")
        with self.assertRaisesRegex(ValueError, "freeChinaRelease"):
            plan.collect()
        self.write("feature/demo/build/outputs/bundle/freeChinaRelease/demo.aab")
        self.assertEqual(plan.collect(), export / "demo.aab")
        self.assertEqual(list(export.iterdir()), [export / "demo.aab"])

    def test_flutter_uses_cli_and_expected_outputs(self):
        self.flutter()
        apk = prepare_project_build(self.config, "apk", "debug")
        self.assertEqual(apk.args, ["build", "apk", "--debug", "--flavor", "demo"])
        apk_path = self.write("build/app/outputs/flutter-apk/app-demo-debug.apk")
        self.assertEqual(apk.collect(), apk_path)
        bundle = prepare_project_build(self.config, "aab", "release")
        self.assertEqual(bundle.args, ["build", "appbundle", "--release", "--flavor", "demo"])
        bundle_path = self.write("build/app/outputs/bundle/demoRelease/app-demo-release.aab")
        self.assertEqual(bundle.collect(), bundle_path)

    def test_rejects_an_invalid_project_or_task(self):
        self.config["projectType"] = "flutter"
        with self.assertRaisesRegex(ValueError, "pubspec.yaml"):
            prepare_project_build(self.config, "apk", "debug")
        self.android()
        self.config["projectBuild"]["gradleModule"] = "app --stop"
        with self.assertRaisesRegex(ValueError, "Gradle 模块"):
            prepare_project_build(self.config, "apk", "debug")
        with self.assertRaisesRegex(ValueError, "构建模式"):
            prepare_project_build(self.config, "web", "debug")
