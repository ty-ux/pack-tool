import json
import os
import sqlite3
import tempfile
import unittest
import zipfile
from contextlib import closing
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from server import apps, config_transfer, data_safety, preferences, signing_keys, storage
from server.config import DEFAULT_CONFIG


class DataManagementTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for module, field, value in (
            (apps, "APPS_DIR", self.root / "config/apps"),
            (apps, "ACTIVE_APP_PATH", self.root / "config/active_app.json"),
            (apps, "CONFIG_PATH", self.root / "config/pack_config.json"),
            (signing_keys, "KEYS_PATH", self.root / "config/signing_keys.json"),
            (preferences, "PATH", self.root / "config/preferences.json"),
        ):
            context = patch.object(module, field, value)
            context.start()
            self.addCleanup(context.stop)

    def bundle(self, cfg=None):
        return {"format": "packtool-config", "schemaVersion": 1,
                "apps": [{"config": cfg or deepcopy(DEFAULT_CONFIG)}]}

    def test_upgrade_snapshot_includes_config_packages_history_logs_and_output(self):
        for relative in ("config/apps/old.json", "packages/fixture.aar", "logs/builds/1.log", "output/old.apk", "icon/app.png"):
            file = self.root / relative
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b"old data")
        (self.root / "data").mkdir()
        with closing(sqlite3.connect(self.root / "data/build_history.db")) as conn, conn:
            conn.execute("CREATE TABLE fixture (value TEXT)")
            conn.execute("INSERT INTO fixture VALUES ('old history')")
        data_safety.ensure_data_version(self.root, "2.6.0")
        backups = list((self.root / "backups").glob("*.zip"))
        self.assertEqual(len(backups), 1)
        with zipfile.ZipFile(backups[0]) as archive:
            self.assertEqual(archive.read("config/apps/old.json"), b"old data")
            self.assertEqual(archive.read("logs/builds/1.log"), b"old data")
            self.assertEqual(archive.read("packages/fixture.aar"), b"old data")
            self.assertEqual(archive.read("output/old.apk"), b"old data")
            self.assertIn("data/build_history.db", archive.namelist())
            self.assertFalse(any(name.startswith("backups/") for name in archive.namelist()))
        data_safety.ensure_data_version(self.root, "2.6.0")
        self.assertEqual(len(list((self.root / "backups").glob("*.zip"))), 1)
        data_safety.ensure_data_version(self.root, "2.6.1")
        self.assertEqual(len(list((self.root / "backups").glob("*.zip"))), 2)

    def test_backup_failure_keeps_old_version_marker_and_originals(self):
        marker = self.root / "data-version.json"
        storage.write_json(marker, {"appVersion": "2.5.0"})
        (self.root / "logs").mkdir()
        with patch.object(data_safety, "create_backup", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                data_safety.ensure_data_version(self.root, "2.6.0")
        self.assertEqual(json.loads(marker.read_text())["appVersion"], "2.5.0")

    def test_backup_prunes_gradle_caches_but_keeps_user_gradle_settings(self):
        for relative in ("data/flutter-gradle/caches/modules/dependency.jar",
                         "data/flutter-gradle/wrapper/dists/gradle.zip",
                         "data/flutter-gradle/init.d/private-repository.gradle",
                         "data/flutter-gradle/gradle.properties", "data/custom-user-data.txt"):
            file = self.root / relative
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b"preserve original")
        scandir = os.scandir

        def checked_scandir(path):
            if Path(path).name in ("caches", "wrapper"):
                raise AssertionError("Backup must not traverse regenerable Gradle caches")
            return scandir(path)

        with patch.object(data_safety.os, "scandir", side_effect=checked_scandir):
            backup = data_safety.create_backup(self.root)
        with zipfile.ZipFile(backup) as archive:
            self.assertNotIn("data/flutter-gradle/caches/modules/dependency.jar", archive.namelist())
            self.assertNotIn("data/flutter-gradle/wrapper/dists/gradle.zip", archive.namelist())
            self.assertEqual(archive.read("data/flutter-gradle/init.d/private-repository.gradle"), b"preserve original")
            self.assertEqual(archive.read("data/flutter-gradle/gradle.properties"), b"preserve original")
            self.assertEqual(archive.read("data/custom-user-data.txt"), b"preserve original")
        self.assertTrue((self.root / "data/flutter-gradle/caches/modules/dependency.jar").is_file())

    def test_new_workspace_does_not_create_unneeded_backup(self):
        data_safety.ensure_data_version(self.root, "2.6.0")
        self.assertFalse((self.root / "backups").exists())

    def test_atomic_failure_preserves_previous_configuration(self):
        file = self.root / "config/settings.json"
        storage.write_json(file, {"value": "old"})
        with patch.object(Path, "replace", side_effect=OSError("cannot replace")):
            with self.assertRaises(OSError):
                storage.write_json(file, {"value": "new"})
        self.assertEqual(json.loads(file.read_text()), {"value": "old"})
        self.assertEqual(list(file.parent.glob("*.tmp")), [])

    def test_legacy_migration_archives_only_after_success(self):
        storage.write_json(apps.CONFIG_PATH, DEFAULT_CONFIG)
        with patch.object(apps, "_write_app", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                apps.active_id()
        self.assertTrue(apps.CONFIG_PATH.exists())
        self.assertFalse(apps.CONFIG_PATH.with_name("pack_config.legacy.json").exists())
        self.assertTrue(apps.active_id())
        self.assertTrue(apps.CONFIG_PATH.with_name("pack_config.legacy.json").exists())

    def test_export_resolves_shared_signing_and_never_exports_credentials(self):
        app_id = apps.active_id()
        config = apps.load_app_config(app_id)
        config["signing"] = {"keyId": "shared"}
        signing = {**DEFAULT_CONFIG["signing"], "keystorePath": "D:/keys/demo.jks",
                   "keyAlias": "fixture", "storePasswordEncrypted": "dpapi:secret"}
        with patch.object(signing_keys, "get_signing", return_value=signing), \
                patch.object(apps, "load_app_config", return_value=config):
            bundle = config_transfer.export_config()
        text = json.dumps(bundle)
        self.assertNotIn("dpapi:", text)
        self.assertNotIn("keyId", text)
        self.assertEqual(bundle["apps"][0]["config"]["signing"]["keyAlias"], "fixture")

    def test_import_uses_new_ids_and_preserves_existing_data_and_active_app(self):
        active = apps.active_id()
        before = apps._app_path(active).read_bytes()
        bundle = self.bundle()
        # Even files crafted outside PackTool cannot bring machine-bound credentials.
        bundle["apps"][0]["config"]["signing"].update(storePassword="plain", storePasswordEncrypted="dpapi:foreign", keyId="foreign")
        created = config_transfer.import_config(bundle)
        self.assertNotEqual(created[0], active)
        self.assertEqual(apps.active_id(), active)
        self.assertEqual(apps._app_path(active).read_bytes(), before)
        imported = apps.load_app_config(created[0])
        self.assertEqual(imported["signing"]["storePasswordEncrypted"], "")
        self.assertNotIn("plain", apps._app_path(created[0]).read_text(encoding="utf-8"))

    def test_invalid_bundle_writes_nothing(self):
        for config in ({"paths": []}, {"signing": []}, {"projectType": "unknown"}, {"web": {"ssr": "yes"}}):
            with self.subTest(config=config), self.assertRaises(ValueError):
                config_transfer.import_config(self.bundle(config))
        self.assertFalse(apps.APPS_DIR.exists())
        bundle = self.bundle()
        bundle["schemaVersion"] = 99
        with self.assertRaises(ValueError):
            config_transfer.import_config(bundle)

    def test_import_rolls_back_new_files_on_partial_write_failure(self):
        original = apps.active_id()
        bundle = self.bundle()
        bundle["apps"] *= 2
        write = apps._write_app
        calls = []
        def fail_second(app_id, config):
            calls.append(app_id)
            if len(calls) == 2:
                raise OSError("disk full")
            return write(app_id, config)
        with patch.object(apps, "_write_app", side_effect=fail_second):
            with self.assertRaises(OSError):
                config_transfer.import_config(bundle)
        self.assertEqual([file.stem for file in apps.APPS_DIR.glob("*.json")], [original])

    def test_preview_does_not_write_and_reports_missing_paths(self):
        config = deepcopy(DEFAULT_CONFIG)
        config["paths"]["projectDir"] = str(self.root / "missing project")
        rows = config_transfer.preview_import(self.bundle(config))
        self.assertIn("projectDir", rows[0]["missingPaths"])
        self.assertFalse(apps.APPS_DIR.exists())

    def test_theme_survives_reload_and_is_in_workspace(self):
        self.assertEqual(preferences.read()["colorScheme"], "system")
        preferences.save("dark")
        self.assertEqual(preferences.read()["colorScheme"], "dark")


if __name__ == "__main__":
    unittest.main()
