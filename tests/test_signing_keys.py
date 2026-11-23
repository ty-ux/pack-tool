import json
import os
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from server import apps, config, signing_keys
from server.project_builds import prepare_project_build
from server.signing import resolve_signing, signing_environment, signing_passwords


class SharedSigningTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="packtool shared keys ")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for module, field, value in (
            (apps, "APPS_DIR", self.root / "apps"),
            (apps, "ACTIVE_APP_PATH", self.root / "active.json"),
            (apps, "CONFIG_PATH", self.root / "legacy.json"),
            (signing_keys, "KEYS_PATH", self.root / "keys.json"),
        ):
            context = patch.object(module, field, value)
            context.start()
            self.addCleanup(context.stop)
        self.file = self.root / "test.jks"
        self.file.touch()
        self.settings = deepcopy(config.DEFAULT_CONFIG["signing"])
        self.settings.update(keystorePath=str(self.file), keyAlias="fixture", passwordMode="env",
                             storePasswordEnv="PACKTOOL_SHARED_STORE", keyPasswordEnv="PACKTOOL_SHARED_KEY")
        environment = patch.dict(os.environ, {"PACKTOOL_SHARED_STORE": "store fixture", "PACKTOOL_SHARED_KEY": "key fixture"})
        environment.start()
        self.addCleanup(environment.stop)

    def create_key(self):
        return signing_keys.save_key("Shared fixture", self.settings)

    def test_profiles_share_live_settings_and_block_delete_while_used(self):
        key = self.create_key()
        ids = []
        for name in ("one", "two"):
            apps.create_app(name, "flutter")
            cfg = apps.load_active_config()
            cfg["signing"] = {**self.settings, "keyId": key["id"], "storePassword": "must be discarded"}
            apps.save_active_config(cfg)
            ids.append(apps.active_id())
            stored = json.loads((self.root / "apps" / f'{ids[-1]}.json').read_text(encoding="utf-8"))
            self.assertEqual(stored["config"]["signing"], {"keyId": key["id"]})
        self.assertEqual(len(signing_keys.list_keys()[0]["usedBy"]), 2)
        with self.assertRaisesRegex(ValueError, "正在被应用使用"):
            signing_keys.delete_key(key["id"])
        changed = {**self.settings, "keyAlias": "new-alias"}
        signing_keys.save_key("Renamed", changed, key["id"])
        for app_id in ids:
            self.assertEqual(resolve_signing(apps.load_app_config(app_id))["signing"]["keyAlias"], "new-alias")
        for app_id in ids:
            apps.set_active(app_id)
            cfg = apps.load_active_config()
            cfg["signing"] = deepcopy(config.DEFAULT_CONFIG["signing"])
            apps.save_active_config(cfg)
        signing_keys.delete_key(key["id"])
        self.assertEqual(signing_keys.list_keys(), [])
        self.assertTrue(self.file.exists())

    def test_import_is_deduplicated_and_does_not_change_legacy_profiles(self):
        before = {}
        for name in ("first", "second"):
            apps.create_app(name)
            cfg = apps.load_active_config()
            cfg["signing"] = self.settings
            apps.save_active_config(cfg)
            path = self.root / "apps" / f'{apps.active_id()}.json'
            before[path] = path.read_bytes()
        self.assertEqual(signing_keys.import_app_keys(), 1)
        self.assertEqual(signing_keys.import_app_keys(), 0)
        self.assertEqual(len(signing_keys.list_keys()), 1)
        for path, raw in before.items():
            self.assertEqual(path.read_bytes(), raw)
        signing_keys.delete_key(signing_keys.list_keys()[0]["id"])
        self.assertEqual(signing_keys.import_app_keys(), 0)
        cfg = apps.load_active_config()
        cfg["signing"]["keyAlias"] = "changed"
        apps.save_active_config(cfg)
        self.assertEqual(signing_keys.import_app_keys(), 1)

    def test_missing_keys_and_corrupt_library_are_not_silently_replaced(self):
        cfg = deepcopy(config.DEFAULT_CONFIG)
        cfg["signing"]["keyId"] = "missing"
        with self.assertRaisesRegex(ValueError, "不存在"):
            apps.save_active_config(cfg)
        with self.assertRaisesRegex(ValueError, "不存在"):
            signing_environment(cfg)
        signing_keys.KEYS_PATH.write_text("bad json", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "无法读取"):
            self.create_key()
        self.assertEqual(signing_keys.KEYS_PATH.read_text(encoding="utf-8"), "bad json")

    def test_shared_keys_reach_flutter_native_and_react_native_builds(self):
        key = self.create_key()
        for kind in ("flutter", "android", "react-native"):
            with self.subTest(kind=kind):
                project = self.root / kind
                (project / "android").mkdir(parents=True)
                (project / "pubspec.yaml").write_text("name: fixture", encoding="utf-8")
                (project / "package.json").write_text("{}", encoding="utf-8")
                cli = project / "flutter.bat"
                cli.touch()
                wrapper = "gradlew.bat" if os.name == "nt" else "gradlew"
                (project / wrapper).touch()
                (project / "android" / wrapper).touch()
                cfg = deepcopy(config.DEFAULT_CONFIG)
                cfg["projectType"] = kind
                cfg["paths"].update(projectDir=str(project), flutterCli=str(cli))
                cfg["signing"] = {"keyId": key["id"]}
                for platform in ("apk", "aab"):
                    plan = prepare_project_build(cfg, platform, "release")
                    self.assertEqual(plan.env["PACK_TOOL_SIGNING_FILE"], str(self.file))
                    self.assertEqual(plan.env["PACK_TOOL_SIGNING_STORE_PASSWORD"], "store fixture")
                    self.assertEqual(plan.env["PACK_TOOL_SIGNING_MODULE"], ":app")
                    self.assertNotIn("store fixture", " ".join(plan.command))
                    if kind != "flutter":
                        self.assertIn("--init-script", plan.args)

    def test_password_reveal_is_explicit_and_uncacheable(self):
        from server.routers.api import get_signing_keys, reveal_signing_key
        key = self.create_key()
        listed = get_signing_keys()
        self.assertEqual(listed.headers["Cache-Control"], "no-store")
        self.assertNotIn(b"store fixture", listed.body)
        self.assertNotIn(b"key fixture", listed.body)
        revealed = reveal_signing_key(key["id"])
        self.assertEqual(revealed.headers["Cache-Control"], "no-store")
        self.assertEqual(json.loads(revealed.body)["storePassword"], "store fixture")

    @unittest.skipUnless(os.name == "nt", "Windows DPAPI credentials")
    def test_local_passwords_are_encrypted_and_import_deduplicates_random_dpapi_blobs(self):
        settings = {**self.settings, "passwordMode": "local", "storePassword": "local fixture store",
                    "keyPassword": "local fixture key"}
        for name in ("a", "b"):
            apps.create_app(name)
            cfg = apps.load_active_config()
            cfg["signing"] = settings
            apps.save_active_config(cfg)
        self.assertEqual(signing_keys.import_app_keys(), 1)
        key = signing_keys.list_keys()[0]
        self.assertNotIn("local fixture", signing_keys.KEYS_PATH.read_text(encoding="utf-8"))
        self.assertNotIn("storePassword", key["signing"])
        self.assertNotIn("keyPassword", key["signing"])
        self.assertEqual(signing_keys.reveal_passwords(key["id"])["keyPassword"], "local fixture key")
        cfg = {"signing": {"keyId": key["id"]}}
        self.assertEqual(signing_passwords(cfg), ("local fixture store", "local fixture key"))
        signing_keys.save_key("edited", {"keyAlias": "edited"}, key["id"])
        self.assertEqual(signing_passwords(cfg), ("local fixture store", "local fixture key"))
        signing_keys.save_key("edited", {"keyPasswordEncrypted": ""}, key["id"])
        self.assertEqual(signing_passwords(cfg), ("local fixture store", "local fixture store"))
