import hashlib
import os
import shutil
import subprocess
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from server.config import DEFAULT_CONFIG
from server.signing import protect_config
from server.signing_verify import verify_signing


class SigningVerificationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        home = os.environ.get("JAVA_HOME")
        filename = "keytool.exe" if os.name == "nt" else "keytool"
        keytool = str(Path(home) / "bin" / filename) if home and (Path(home) / "bin" / filename).is_file() else shutil.which("keytool")
        if not keytool:
            raise unittest.SkipTest("JDK keytool is unavailable")
        cls.keytool = Path(keytool).resolve()
        cls.jdk = cls.keytool.parent.parent
        cls.temporary = tempfile.TemporaryDirectory(prefix="packtool verify ")
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.environment = {**os.environ, "PACKTOOL_TEST_STORE": "fixture store password",
                           "PACKTOOL_TEST_KEY": "fixture key password"}
        for kind in ("JKS", "PKCS12"):
            args = [str(cls.keytool), "-genkeypair", "-keystore", str(cls.root / f"fixture.{kind}"),
                    "-storetype", kind, "-alias", "fixture", "-keyalg", "RSA", "-keysize", "2048",
                    "-validity", "2", "-dname", "CN=PackTool verifier test", "-storepass:env", "PACKTOOL_TEST_STORE",
                    "-keypass:env", "PACKTOOL_TEST_KEY" if kind == "JKS" else "PACKTOOL_TEST_STORE"]
            subprocess.run(args, env=cls.environment, capture_output=True, check=True, timeout=30)
        cert = cls.root / "public.cert"
        common = [str(cls.keytool), "-keystore", str(cls.root / "fixture.JKS"),
                  "-storepass:env", "PACKTOOL_TEST_STORE"]
        subprocess.run([*common, "-exportcert", "-alias", "fixture", "-file", str(cert)],
                       env=cls.environment, capture_output=True, check=True, timeout=30)
        subprocess.run([*common, "-importcert", "-noprompt", "-alias", "public-only", "-file", str(cert)],
                       env=cls.environment, capture_output=True, check=True, timeout=30)

    def config(self, kind="JKS"):
        cfg = deepcopy(DEFAULT_CONFIG)
        cfg["paths"]["javaHome"] = str(self.jdk)
        cfg["signing"].update(keystorePath=str(self.root / f"fixture.{kind}"), keyAlias="fixture",
                              storePassword=self.environment["PACKTOOL_TEST_STORE"],
                              keyPassword=self.environment["PACKTOOL_TEST_KEY"] if kind == "JKS" else "")
        return cfg

    def test_real_keystores_and_wrong_credentials_without_modifying_files(self):
        for kind in ("JKS", "PKCS12"):
            file = self.root / f"fixture.{kind}"
            before = hashlib.sha256(file.read_bytes()).digest()
            for field, value, expected in ((None, None, "验证通过"),
                    ("storePassword", "wrong password", "密钥库密码"),
                    ("keyPassword", "wrong password", "密钥密码不正确"),
                    ("keyAlias", "missing-alias", "找不到")):
                with self.subTest(kind=kind, field=field):
                    cfg = self.config(kind)
                    if field:
                        cfg["signing"][field] = value
                    result = verify_signing(cfg)
                    self.assertEqual(result["ok"], field is None)
                    self.assertIn(expected, result["message"])
            self.assertEqual(hashlib.sha256(file.read_bytes()).digest(), before)

    def test_public_certificate_cannot_be_used_as_signing_key(self):
        cfg = self.config()
        cfg["signing"]["keyAlias"] = "public-only"
        result = verify_signing(cfg)
        self.assertFalse(result["ok"])
        self.assertIn("没有可用于签名的私钥", result["message"])

    def test_shared_profile_resolves_for_real_keystore_verification(self):
        from server import signing_keys
        cfg = self.config()
        cfg["signing"].update(passwordMode="env", storePasswordEnv="PACKTOOL_TEST_STORE", keyPasswordEnv="PACKTOOL_TEST_KEY")
        with patch.object(signing_keys, "KEYS_PATH", self.root / "library.json"), \
                patch.object(signing_keys, "_usage", return_value=[]), patch.dict(os.environ, self.environment):
            profile = signing_keys.save_key("fixture", cfg["signing"])
            cfg["signing"] = {"keyId": profile["id"]}
            self.assertTrue(verify_signing(cfg)["ok"])

    @unittest.skipUnless(os.name == "nt", "Windows credential protection")
    def test_saved_encrypted_passwords_can_be_verified(self):
        self.assertTrue(verify_signing(protect_config(self.config()))["ok"])

    def test_passwords_only_pass_in_child_environment_and_raw_errors_are_hidden(self):
        cfg = self.config()
        before = os.environ.copy()
        success = subprocess.CompletedProcess([], 0, b"PACKTOOL_SIGNING:ok\n", b"")
        with patch("server.signing_verify.subprocess.run", return_value=success) as run:
            self.assertTrue(verify_signing(cfg)["ok"])
            arguments, options = run.call_args
            for secret in (self.environment["PACKTOOL_TEST_STORE"], self.environment["PACKTOOL_TEST_KEY"]):
                self.assertNotIn(secret, " ".join(arguments[0]))
            self.assertEqual(options["env"]["PACK_TOOL_VERIFY_KEY_PASSWORD"], cfg["signing"]["keyPassword"])
            self.assertEqual(options["input"], "")
        failure = subprocess.CompletedProcess([], 1, b"unexpected raw output", b"fixture key password")
        with patch("server.signing_verify.subprocess.run", return_value=failure):
            with self.assertRaisesRegex(ValueError, "完整的 JDK") as error:
                verify_signing(cfg)
            self.assertNotIn("fixture key password", str(error.exception))
        with patch("server.signing_verify.subprocess.run", side_effect=subprocess.TimeoutExpired("java", 45)):
            with self.assertRaisesRegex(ValueError, "超时"):
                verify_signing(cfg)
        self.assertEqual(os.environ, before)
