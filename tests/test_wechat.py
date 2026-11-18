import copy
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from server.config import DEFAULT_CONFIG
from server.wechat import prepare_wechat_build


class WechatBuildTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.project = self.root / "小程序 project"
        self.project.mkdir()
        source = self.project / "miniprogram"
        source.mkdir()
        (source / "app.json").write_text("{}", encoding="utf-8")
        self.appid = "wx0123456789abcdef"
        (self.project / "project.config.json").write_text(json.dumps({
            "appid": self.appid, "miniprogramRoot": "miniprogram/",
        }), encoding="utf-8")
        self.key = self.root / "key outside project.key"
        self.key.write_text("placeholder", encoding="utf-8")
        self.cfg = copy.deepcopy(DEFAULT_CONFIG)
        self.cfg["projectType"] = "wechat-miniprogram"
        self.cfg["paths"]["projectDir"] = str(self.project)
        self.cfg["wechat"]["privateKeyPath"] = str(self.key)
        self.profile = "0a0b0c1d"
        self.enterContext(patch("server.wechat.LOGS_DIR", self.root / "logs"))

    def test_key_inside_source_is_rejected(self):
        key = self.project / "upload.key"
        key.touch()
        self.cfg["wechat"]["privateKeyPath"] = str(key)
        with self.assertRaisesRegex(ValueError, "目录之外"):
            prepare_wechat_build(self.cfg, "upload", self.profile)

    def test_appid_mismatch_is_rejected(self):
        self.cfg["wechat"]["appid"] = "wx123456789abcdef0"
        with self.assertRaisesRegex(ValueError, "不一致"):
            prepare_wechat_build(self.cfg, "preview", self.profile)

    def test_hbuilderx_compiles_without_credentials_or_upload(self):
        cli = self.root / "cli.exe"
        cli.touch()
        (self.project / "manifest.json").touch()
        self.cfg["projectType"] = "uniapp"
        self.cfg["paths"]["hbuilderxCli"] = str(cli)
        self.cfg["wechat"]["privateKeyPath"] = ""
        plan = prepare_wechat_build(self.cfg, "compile", self.profile)
        self.assertEqual(plan.args, ["publish", "mp-weixin", "--project", str(self.project), "--upload", "false"])
        self.assertTrue(str(plan.artifact_root).endswith(str(Path("unpackage/dist/build/mp-weixin"))))

    @unittest.skipUnless(shutil.which("node") and shutil.which("npm"), "Node.js and npm are needed for uni-app CLI")
    def test_uni_cli_creates_a_fresh_mini_program(self):
        (self.project / "package.json").write_text(json.dumps({
            "scripts": {"build:mp-weixin": "node compile.cjs"},
        }), encoding="utf-8")
        (self.project / "compile.cjs").write_text(
            """
const fs = require('node:fs')
const dest = './dist/build/mp-weixin'
fs.mkdirSync(dest, { recursive: true })
fs.writeFileSync(dest + '/app.json', '{}')
fs.writeFileSync(dest + '/project.config.json', '{}')
""", encoding="utf-8")
        self.cfg["projectType"] = "uniapp"
        self.cfg["wechat"]["privateKeyPath"] = ""
        plan = prepare_wechat_build(self.cfg, "compile", self.profile)
        subprocess.run(plan.command, cwd=plan.working_dir, env=plan.env, check=True, capture_output=True)
        self.assertEqual(plan.collect(), self.project / "dist/build/mp-weixin")
        next_plan = prepare_wechat_build(self.cfg, "compile", self.profile)
        with self.assertRaisesRegex(ValueError, "本次生成"):
            next_plan.collect()

    @unittest.skipUnless(shutil.which("node"), "Node.js is needed to execute the CI adapter")
    def test_native_actions_use_separate_ci_operations(self):
        ci = self.project / "node_modules" / "miniprogram-ci"
        ci.mkdir(parents=True)
        (ci / "index.js").write_text(
            """
const fs = require('node:fs')
module.exports = {
  Project: class { constructor(options) { this.options = options } },
  getCompiledResult: async (_, destination) => fs.writeFileSync(destination, 'compiled'),
  preview: async ({ qrcodeOutputDest }) => fs.writeFileSync(qrcodeOutputDest, 'preview'),
  upload: async ({ project, version }) => console.log(project.options.appid, version),
}
""", encoding="utf-8")
        for action, contents in (("compile", b"compiled"), ("preview", b"preview"), ("upload", None)):
            with self.subTest(action=action):
                plan = prepare_wechat_build(self.cfg, action, self.profile)
                self.assertNotIn(os.fspath(self.key), plan.command)
                result = subprocess.run(plan.command, cwd=plan.working_dir, env=plan.env, check=True, capture_output=True)
                artifact = plan.collect()
                if contents is None:
                    self.assertIsNone(artifact)
                    self.assertIn(f"{self.appid} 1.0.0".encode(), result.stdout)
                else:
                    self.assertEqual(artifact.read_bytes(), contents)


if __name__ == "__main__":
    unittest.main()
