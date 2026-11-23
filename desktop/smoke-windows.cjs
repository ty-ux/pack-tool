const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const testRoot = fs.mkdtempSync(path.join(__dirname, 'out', 'smoke-'))
const unpacked = path.join(testRoot, 'unpacked')
const userData = path.join(testRoot, 'user-data')

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, { stdio: 'inherit', timeout: 90_000, ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(executable + ' exited with code ' + result.status)
}

try {
  run(process.env.PACK_TOOL_PYTHON || 'python', [
    '-m', 'zipfile', '-e', path.join(__dirname, 'out', 'PackTool-win-x64.zip'), unpacked,
  ])
  const application = path.join(unpacked, 'PackTool-win32-x64')
  if (!fs.existsSync(path.join(application, 'resources', 'backend', '_internal', 'scripts', 'wechat-ci.cjs'))) {
    throw new Error('Missing WeChat CI runner in the bundled backend')
  }
  if (!fs.existsSync(path.join(application, 'resources', 'backend', '_internal', 'scripts', 'VerifySigning.java'))) {
    throw new Error('Missing signing verifier in the bundled backend')
  }
  fs.mkdirSync(userData)
  const jdk = path.join(testRoot, 'test JDK')
  fs.mkdirSync(path.join(jdk, 'bin'), { recursive: true })
  for (const exe of ['java.exe', 'javac.exe']) fs.writeFileSync(path.join(jdk, 'bin', exe), '')
  const project = path.join(testRoot, 'test Flutter project')
  fs.mkdirSync(path.join(project, 'android'), { recursive: true })
  fs.writeFileSync(path.join(project, 'pubspec.yaml'), 'name: packtool_smoke\n')
  fs.writeFileSync(path.join(project, 'fixture.jks'), 'smoke signing profile fixture')
  // An inherited live desktop stdin pipe would block this read indefinitely.
  fs.writeFileSync(path.join(project, 'flutter.bat'), [
    '@echo off',
    'set /p PACKTOOL_TEST_INPUT=',
    'if defined PACKTOOL_TEST_INPUT exit /b 1',
    'if not exist build\\app\\outputs\\flutter-apk mkdir build\\app\\outputs\\flutter-apk',
    'echo fixture>build\\app\\outputs\\flutter-apk\\app-debug.apk',
    'echo PACKTOOL-CHILD-EOF',
    'exit /b 0',
    '',
  ].join('\r\n'))
  run(path.join(application, 'PackTool.exe'), ['--smoke-test'], {
    cwd: testRoot,
    env: { ...process.env, PACK_TOOL_SMOKE_DIR: userData, PACK_TOOL_SMOKE_PROJECT: project, JAVA_HOME: jdk },
  })
  const workspace = path.join(userData, 'workspace')
  for (const file of ['config/active_app.json', 'data/build_history.db']) {
    if (!fs.existsSync(path.join(workspace, file))) throw new Error('Missing user data: ' + file)
  }
  console.log('PackTool release ZIP passed the Windows desktop smoke test')
} finally {
  try {
    fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  } catch (error) {
    // Windows may briefly retain a directory handle after Electron exits.
    // Cleanup must not replace an assertion failure or reject a successful test.
    if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error
    console.warn('Temporary smoke files are still locked and were left at: ' + testRoot)
  }
}
