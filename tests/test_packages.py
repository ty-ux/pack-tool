import io
import logging
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from server import packages
from server.packages import _sync_logger as create_sync_logger
from server.routers.api import package_sync_log, sync_packages
from fastapi import HTTPException


class PackageSyncTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.source = self.root / "packages"
        self.source.mkdir()
        self.integrate = self.root / "offline"
        self.integrate.mkdir()
        self.stream = io.StringIO()
        logger = logging.Logger("package-sync-test")
        logger.addHandler(logging.StreamHandler(self.stream))
        for name, value in (
            ("PACKAGES_DIR", self.source),
            ("PACKAGES_PATH", self.root / "packages.json"),
            ("SYNC_LOG", self.root / "packages-sync.log"),
            ("_sync_logger", lambda: logger),
        ):
            context = patch.object(packages, name, value)
            context.start()
            self.addCleanup(context.stop)
        context = patch.object(packages.config_mod, "load_config", return_value={
            "paths": {"integrateDir": str(self.integrate)},
        })
        self.config = context.start()
        self.addCleanup(context.stop)

    def test_unconfigured_target_preserves_failure_reason(self):
        self.config.return_value = {"paths": {"integrateDir": ""}}
        response = sync_packages()
        self.assertFalse(response["ok"])
        self.assertIn("离线工程目录未配置或不存在", response["error"])
        self.assertEqual(response["summary"]["error"], 1)
        self.assertIn("Traceback", self.stream.getvalue())

    def test_missing_sources_return_per_package_errors(self):
        response = sync_packages()
        self.assertFalse(response["ok"])
        errors = [item for item in response["results"] if item["action"] == "error"]
        self.assertEqual(len(errors), response["summary"]["error"])
        self.assertIn("源文件缺失", response["error"])
        self.assertIn("同步结束 ok=False", self.stream.getvalue())

    def test_copy_and_skip_keep_callback_and_file_logs(self):
        for package in packages.load_packages():
            (self.source / package["file"]).write_bytes(b"fixture")
        messages = []
        ok, results, summary = packages.sync_packages(log=messages.append)
        self.assertTrue(ok)
        self.assertEqual(summary["copy"], len(results))
        self.assertTrue(messages)
        self.assertIn("PackTool=", self.stream.getvalue())
        ok, results, summary = packages.sync_packages()
        self.assertTrue(ok)
        self.assertEqual(summary["skip"], len(results))

    def test_interruption_does_not_erase_existing_error_count(self):
        with patch.object(packages.os, "listdir", side_effect=PermissionError("cannot list libs")):
            response = sync_packages()
        self.assertEqual(response["summary"]["error"], len(response["results"]) + 1)
        self.assertIn("cannot list libs", response["error"])

    def test_permission_error_is_reported_and_logged(self):
        package = packages.load_packages()[0]
        (self.source / package["file"]).write_bytes(b"fixture")
        with patch.object(packages.shutil, "copy2", side_effect=PermissionError("denied")):
            response = sync_packages()
        self.assertFalse(response["ok"])
        self.assertIn("denied", response["results"][0]["message"])
        self.assertIn("Traceback", self.stream.getvalue())

    def test_log_download_and_missing_log(self):
        with self.assertRaises(HTTPException) as error:
            package_sync_log()
        self.assertEqual(error.exception.status_code, 404)
        packages.SYNC_LOG.write_text("diagnostic", encoding="utf-8")
        response = package_sync_log()
        self.assertEqual(response.path, packages.SYNC_LOG)
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_file_logger_appends_and_rotates_without_touching_existing_build_log(self):
        packages.SYNC_LOG.write_text("previous sync\n", encoding="utf-8")
        build_log = self.root / "build.log"
        build_log.write_text("existing build", encoding="utf-8")
        logger = logging.Logger("file-logger-test")
        self.addCleanup(lambda: [handler.close() for handler in logger.handlers])
        with patch.object(packages.logging, "getLogger", return_value=logger):
            self.assertIs(create_sync_logger(), create_sync_logger())
        self.assertEqual(len(logger.handlers), 1)
        handler = logger.handlers[0]
        self.assertEqual(handler.backupCount, 3)
        self.assertEqual(handler.maxBytes, 2 * 1024 * 1024)
        logger.info("new sync 中文")
        self.assertIn("previous sync", packages.SYNC_LOG.read_text(encoding="utf-8"))
        self.assertIn("new sync 中文", packages.SYNC_LOG.read_text(encoding="utf-8"))
        handler.maxBytes = 1
        logger.info("next sync")
        backup = packages.SYNC_LOG.with_name(packages.SYNC_LOG.name + ".1")
        self.assertIn("previous sync", backup.read_text(encoding="utf-8"))
        self.assertEqual(build_log.read_text(encoding="utf-8"), "existing build")

    def test_unwritable_log_does_not_prevent_sync(self):
        logger = logging.Logger("fallback-test")
        self.addCleanup(lambda: [handler.close() for handler in logger.handlers])
        with patch.object(packages.logging, "getLogger", return_value=logger), \
                patch.object(packages, "RotatingFileHandler", side_effect=PermissionError("denied")):
            self.assertIs(create_sync_logger(), logger)
        self.assertIsInstance(logger.handlers[0], logging.StreamHandler)


if __name__ == "__main__":
    unittest.main()
