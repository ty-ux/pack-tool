const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { packager } = require('@electron/packager')
const pkg = require('./package.json')

const root = path.resolve(__dirname, '..')
const out = path.join(__dirname, 'out')
const python = process.env.PACK_TOOL_PYTHON || 'python'

function runPython(args) {
  const result = spawnSync(python, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Python packaging step failed')
}

function copyWebLicenses(destination) {
  const { packages } = require('../web/package-lock.json')
  for (const [relativePath, entry] of Object.entries(packages)) {
    if (!relativePath || entry.dev) continue
    const source = path.join(root, 'web', relativePath)
    if (!fs.existsSync(source)) continue
    const licenses = fs.readdirSync(source, { withFileTypes: true }).filter((file) => (
      file.isFile() && /^(licen[cs]e|copying|notice)([.-]|$)/i.test(file.name)
    ))
    if (!licenses.length) continue
    const target = path.join(destination, relativePath)
    fs.mkdirSync(target, { recursive: true })
    for (const { name } of licenses) {
      fs.copyFileSync(path.join(source, name), path.join(target, name))
    }
  }
}

async function build() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Run Windows packaging with 64-bit Node.js on Windows')
  }
  const frontend = path.join(root, 'web', 'dist')
  if (!fs.existsSync(path.join(frontend, 'index.html'))) {
    throw new Error('Run npm --prefix web run build before packaging')
  }
  const stage = path.join(out, 'app')
  const frozen = path.join(out, 'frozen')
  const backend = path.join(frozen, 'backend')
  const scripts = ['build_apk.ps1', 'build_web.ps1', 'build_wgt.ps1', 'android-signing.init.gradle', 'VerifySigning.java', 'wechat-ci.cjs']
  runPython([
    '-m', 'PyInstaller', '--noconfirm', '--onedir', '--name', 'backend',
    '--distpath', frozen, '--workpath', path.join(out, 'pyinstaller'), '--specpath', out,
    '--paths', root,
    '--hidden-import', 'uvicorn.loops.asyncio',
    '--hidden-import', 'uvicorn.protocols.http.h11_impl',
    '--hidden-import', 'uvicorn.lifespan.on',
    '--recursive-copy-metadata', 'fastapi',
    '--recursive-copy-metadata', 'uvicorn',
    '--copy-metadata', 'python-multipart',
    '--add-data', frontend + ':web/dist',
    ...scripts.flatMap((file) => ['--add-data', path.join(root, 'scripts', file) + ':scripts']),
    path.join(__dirname, 'backend.py'),
  ])
  fs.renameSync(path.join(backend, 'backend.exe'), path.join(backend, 'pack-tool-backend.exe'))

  fs.mkdirSync(stage, { recursive: true })
  fs.copyFileSync(path.join(__dirname, 'main.cjs'), path.join(stage, 'main.cjs'))
  fs.copyFileSync(path.join(__dirname, 'startup.cjs'), path.join(stage, 'startup.cjs'))
  fs.copyFileSync(path.join(__dirname, 'assets', 'pack-tool.ico'), path.join(stage, 'pack-tool.ico'))
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
    name: 'PackTool',
    version: pkg.version,
    main: pkg.main,
    license: pkg.license,
  }))
  const [appDir] = await packager({
    dir: stage,
    out,
    name: 'PackTool',
    platform: 'win32',
    arch: 'x64',
    electronVersion: pkg.devDependencies.electron,
    icon: path.join(__dirname, 'assets', 'pack-tool.ico'),
    asar: true,
    overwrite: true,
    extraResource: [backend],
  })
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(appDir, 'LICENSE.pack-tool.txt'))
  copyWebLicenses(path.join(appDir, 'third-party-licenses', 'web'))
  runPython([
    '-c',
    'from pathlib import Path; import shutil, sys; shutil.copyfile(Path(sys.base_prefix) / "LICENSE.txt", sys.argv[1])',
    path.join(appDir, 'third-party-licenses', 'LICENSE.python.txt'),
  ])
  runPython([
    '-c',
    'from pathlib import Path; import shutil, sys; shutil.make_archive(sys.argv[1], "zip", root_dir=sys.argv[2], base_dir=Path(sys.argv[3]).name)',
    path.join(out, 'PackTool-win-x64'), out, appDir,
  ])
}

build().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
