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
  fs.mkdirSync(userData)
  run(path.join(application, 'PackTool.exe'), ['--smoke-test'], {
    cwd: testRoot,
    env: { ...process.env, PACK_TOOL_SMOKE_DIR: userData },
  })
  const workspace = path.join(userData, 'workspace')
  for (const file of ['config/active_app.json', 'data/build_history.db']) {
    if (!fs.existsSync(path.join(workspace, file))) throw new Error('Missing user data: ' + file)
  }
  console.log('PackTool release ZIP passed the Windows desktop smoke test')
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 })
}
