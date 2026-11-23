import json
import os
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from server import apps, config, history
from server.secret_store import protect, unprotect
from server.signing import protect_config, redact_config, signing_environment, signing_passwords
from server.project_builds import prepare_project_build


@unittest.skipUnless(os.name == "nt", "Windows DPAPI credentials")
class LocalSigningTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="packtool secrets ")
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.cfg = deepcopy(config.DEFAULT_CONFIG)
        self.cfg["signing"].update(keystorePath=str(self.root / "fixture.jks"), keyAlias="fixture",
                                   storePassword=" store 中文 ' $ secret ")
        for name, value in (("APPS_DIR", self.root / "apps"), ("ACTIVE_APP_PATH", self.root / "active.json"),
                            ("CONFIG_PATH", self.root / "legacy.json")):
            context = patch.object(apps, name, value)
            context.start()
            self.addCleanup(context.stop)

    def test_dpapi_round_trip_and_invalid_blob(self):
        secret = self.cfg["signing"]["storePassword"]
        encrypted = protect(secret)
        self.assertNotIn(secret, encrypted)
        self.assertEqual(unprotect(encrypted), secret)
        with self.assertRaisesRegex(ValueError, "重新填写"):
            unprotect("dpapi:invalid")

    def test_flutter_local_passwords_only_enter_child_environment(self):
        self.cfg["projectType"] = "flutter"
        (self.root / "pubspec.yaml").write_text("name: fixture", encoding="utf-8")
        (self.root / "android").mkdir()
        (self.root / "fixture.jks").touch()
        cli = self.root / "flutter.bat"
        cli.touch()
        self.cfg["paths"].update(projectDir=str(self.root), flutterCli=str(cli))
        cfg = protect_config(self.cfg)
        before = os.environ.copy()
        for platform in ("apk", "aab"):
            plan = prepare_project_build(cfg, platform, "release")
            self.assertEqual(plan.env["PACK_TOOL_SIGNING_STORE_PASSWORD"], self.cfg["signing"]["storePassword"])
            self.assertNotIn(self.cfg["signing"]["storePassword"], " ".join(plan.command))
        self.assertEqual(before, os.environ)

    def test_profile_save_replace_clear_and_isolation(self):
        apps.create_app("first")
        apps.save_active_config(self.cfg)
        first = apps.active_id()
        loaded = apps.load_active_config()
        secret = self.cfg["signing"]["storePassword"]
        self.assertNotIn("storePassword", loaded["signing"])
        self.assertNotIn(secret, json.dumps(loaded))
        self.assertNotIn(secret, (self.root / "apps" / f"{first}.json").read_text(encoding="utf-8"))
        loaded["signing"]["storePassword"] = ""
        apps.save_active_config(loaded)
        self.assertEqual(signing_passwords(apps.load_active_config()), (secret, secret))
        apps.create_app("second")
        self.assertFalse(apps.load_active_config()["signing"]["storePasswordEncrypted"])
        other = deepcopy(self.cfg)
        other["signing"].update(storePassword="second password", keyPassword="separate key password")
        apps.save_active_config(other)
        self.assertEqual(signing_passwords(apps.load_active_config()), ("second password", "separate key password"))
        apps.set_active(first)
        self.assertEqual(signing_passwords(apps.load_active_config()), (secret, secret))
        loaded = apps.load_active_config()
        loaded["signing"].update(storePassword="replacement", keyPassword="key replacement")
        apps.save_active_config(loaded)
        loaded = apps.load_active_config()
        loaded["signing"]["keyPasswordEncrypted"] = ""
        apps.save_active_config(loaded)
        self.assertEqual(signing_passwords(apps.load_active_config()), ("replacement", "replacement"))
        loaded["signing"]["storePasswordEncrypted"] = ""
        apps.save_active_config(loaded)
        with self.assertRaisesRegex(ValueError, "密钥库密码"):
            signing_passwords(apps.load_active_config())

    def test_run_config_and_history_never_store_credentials(self):
        saved = protect_config(self.cfg)
        environment = signing_environment(saved)
        secret = self.cfg["signing"]["storePassword"]
        self.assertEqual(environment["PACK_TOOL_SIGNING_STORE_PASSWORD"], secret)
        with patch.object(config, "RUN_CONFIG_PATH", self.root / "run.json"):
            path = config.write_run_config(saved)
        run = json.loads(Path(path).read_text(encoding="utf-8"))
        self.assertEqual(run["signing"]["storePasswordEnv"], "PACK_TOOL_SIGNING_STORE_PASSWORD")
        self.assertNotIn("PasswordEncrypted", json.dumps(run))
        self.assertNotIn(secret, json.dumps(run))
        connections = []
        original_connect = history._connect

        def connect():
            connection = original_connect()
            connections.append(connection)
            return connection

        try:
            with patch.object(history, "DATA_DIR", self.root), patch.object(history, "DB_PATH", self.root / "history.db"), \
                    patch.object(history, "ARCHIVE_DIR", self.root / "logs"), patch.object(history, "_connect", connect):
                history.create_build({"started_at": "2026-11-23 00:00:00", "platform": "apk", "web_type": "h5",
                                      "build_type": "release"}, {**saved, "signing": {**saved["signing"], "keyPassword": "draft"}})
        finally:
            for connection in connections:
                connection.close()
        database = (self.root / "history.db").read_bytes()
        self.assertNotIn(saved["signing"]["storePasswordEncrypted"].encode(), database)
        self.assertNotIn(b'"keyPassword"', database)
        self.assertNotIn(secret.encode(), database)
        self.assertNotIn("storePasswordEncrypted", redact_config(saved)["signing"])


class LegacySigningTest(unittest.TestCase):
    def test_environment_mode_is_preserved(self):
        cfg = {"signing": {"passwordMode": "env", "storePasswordEnv": "PACKTOOL_LEGACY_TEST"}}
        with patch.dict(os.environ, {"PACKTOOL_LEGACY_TEST": "environment password"}):
            self.assertEqual(signing_passwords(cfg), ("environment password", "environment password"))

    def test_existing_profile_with_available_environment_keeps_its_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "legacy.json").write_text(json.dumps({"config": {
                "signing": {"storePasswordEnv": "PACKTOOL_LEGACY_TEST"},
            }}), encoding="utf-8")
            with patch.object(apps, "APPS_DIR", root):
                with patch.dict(os.environ, {"PACKTOOL_LEGACY_TEST": "environment password"}):
                    self.assertEqual(apps.load_app_config("legacy")["signing"]["passwordMode"], "env")
                with patch.dict(os.environ, {"PACKTOOL_LEGACY_TEST": ""}):
                    self.assertEqual(apps.load_app_config("legacy")["signing"]["passwordMode"], "local")
