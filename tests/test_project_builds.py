import json
import os
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

from server.config import DEFAULT_CONFIG
from server.local_tools import executable_name
from server.project_builds import prepare_project_build


class ProjectBuildTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="packtool fixture ")
        self.addCleanup(temporary.cleanup)
        self.project = Path(temporary.name).resolve()
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

    def test_react_native_uses_android_gradle_project(self):
        self.config["projectType"] = "react-native"
        self.config["projectBuild"] = {"gradleModule": "mobile", "flavor": "demo"}
        self.write("package.json", '{"name": "fixture"}')
        wrapper = self.write("android/gradlew.bat" if os.name == "nt" else "android/gradlew")

        apk = prepare_project_build(self.config, "apk", "debug")
        self.assertEqual(apk.working_dir, self.project / "android")
        self.assertEqual(apk.executable, wrapper)
        self.assertEqual(apk.args[0], ":mobile:assembleDemoDebug")
        apk_path = self.write("android/mobile/build/outputs/apk/demo/debug/mobile-demo-debug.apk")
        self.assertEqual(apk.collect(), apk_path)

        bundle = prepare_project_build(self.config, "aab", "release")
        self.assertEqual(bundle.args[0], ":mobile:bundleDemoRelease")
        self.assertIn("--no-configure-on-demand", bundle.args)
        bundle_path = self.write("android/mobile/build/outputs/bundle/demoRelease/mobile-demo-release.aab")
        self.assertEqual(bundle.collect(), bundle_path)

    def test_react_native_requires_project_root_and_native_wrapper(self):
        self.config["projectType"] = "react-native"
        with self.assertRaisesRegex(ValueError, "package.json"):
            prepare_project_build(self.config, "apk", "debug")
        self.write("package.json", '{"name": "fixture"}')
        (self.project / "android").mkdir()
        self.write("gradlew.bat" if os.name == "nt" else "gradlew")
        with self.assertRaisesRegex(ValueError, "Gradle Wrapper"):
            prepare_project_build(self.config, "apk", "debug")

    def test_selected_sdk_and_node_apply_only_to_the_build_process(self):
        self.config["projectType"] = "react-native"
        self.write("package.json", "{}")
        self.write("android/gradlew.bat" if os.name == "nt" else "android/gradlew")
        sdk = self.project / "SDK"
        (sdk / "platforms").mkdir(parents=True)
        node = self.write(f"Node/{executable_name('node')}").parent
        self.config["paths"].update(androidSdk=str(sdk), nodeDir=str(node))
        original_env = os.environ.copy()

        plan = prepare_project_build(self.config, "apk", "release")

        self.assertEqual(plan.env["ANDROID_HOME"], str(sdk))
        self.assertEqual(plan.env["ANDROID_SDK_ROOT"], str(sdk))
        self.assertEqual(plan.env["PATH"].split(os.pathsep)[0], str(node))
        self.assertEqual(os.environ, original_env)
        self.config["paths"]["androidSdk"] = str(self.project / "missing")
        with self.assertRaisesRegex(ValueError, "Android SDK"):
            prepare_project_build(self.config, "apk", "release")

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
