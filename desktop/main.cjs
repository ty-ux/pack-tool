const { app, BrowserWindow, dialog } = require('electron')
const { spawn } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { mkdirSync } = require('node:fs')
const path = require('node:path')
const { createInterface } = require('node:readline')

const smokeTest = process.argv.includes('--smoke-test')
if (smokeTest && process.env.PACK_TOOL_SMOKE_DIR) {
  app.setPath('userData', process.env.PACK_TOOL_SMOKE_DIR)
}

let backend
let mainWindow
let stopping = false
let exitCode = 0
let stopTimer

function fail(error) {
  exitCode = 1
  console.error(error)
  if (!smokeTest) {
    dialog.showErrorBox('PackTool 启动失败', error.message)
  }
  if (backend) app.quit()
  else app.exit(exitCode)
}

function waitForPort(child) {
  return new Promise((resolve, reject) => {
    const lines = createInterface({ input: child.stdout })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-3000)
    })
    const timer = setTimeout(() => {
      reject(new Error('等待本地服务启动超时。' + stderr))
    }, 30_000)

    lines.once('line', (line) => {
      clearTimeout(timer)
      try {
        const { port } = JSON.parse(line)
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error('本地服务返回了无效端口。')
        }
        resolve(port)
      } catch (error) {
        reject(error)
      }
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      reject(new Error('本地服务退出（' + code + '）。' + stderr))
    })
  })
}

async function openWindow() {
  const dataDir = path.join(app.getPath('userData'), 'workspace')
  mkdirSync(dataDir, { recursive: true })
  const token = randomBytes(32).toString('hex')
  const executable = app.isPackaged
    ? path.join(process.resourcesPath, 'backend', 'pack-tool-backend.exe')
    : process.env.PACK_TOOL_PYTHON || 'python'
  const args = app.isPackaged ? [] : ['-m', 'desktop.backend']
  backend = spawn(executable, args, {
    cwd: app.isPackaged ? dataDir : path.join(__dirname, '..'),
    env: {
      ...process.env,
      PACK_TOOL_DESKTOP_TOKEN: token,
      PACK_TOOL_DATA_DIR: dataDir,
      PYTHONIOENCODING: 'utf-8',
    },
    windowsHide: true,
  })
  backend.stdin.on('error', () => {})
  backend.once('close', () => {
    backend = null
    clearTimeout(stopTimer)
    if (stopping) app.exit(exitCode)
    else if (mainWindow) fail(new Error('本地服务已意外停止。请重新启动 PackTool。'))
  })
  const origin = 'http://127.0.0.1:' + await waitForPort(backend)
  if (stopping) return

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 820,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  })
  const contents = mainWindow.webContents
  const webSession = contents.session
  await webSession.setProxy({ mode: 'direct' })
  webSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  webSession.webRequest.onBeforeSendHeaders({ urls: ['http://127.0.0.1/*'] }, (details, callback) => {
    if (details.webContentsId === contents.id && new URL(details.url).origin === origin) {
      details.requestHeaders['X-Pack-Tool-Token'] = token
    }
    callback({ requestHeaders: details.requestHeaders })
  })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault()
  })

  await mainWindow.loadURL(origin)
  if (!smokeTest) {
    mainWindow.show()
    return
  }

  const response = await fetch(origin + '/api/apps')
  if (response.status !== 403) throw new Error('Desktop API accepted a request without its session token')
  const ready = await contents.executeJavaScript(
    'Promise.all([fetch("/api/apps").then(r => r.json()), fetch("/api/history").then(r => r.json())])' +
    '.then(([apps, history]) => apps.ok && history.ok && document.querySelector("#root")?.childElementCount > 0)',
  )
  if (!ready) throw new Error('React, application configuration or build history did not load')
  const typedApps = await contents.executeJavaScript(`
    (async () => {
      for (const projectType of ['android', 'flutter']) {
        const app = await fetch('/api/apps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: projectType, projectType }),
        }).then(response => response.json())
        if (!app.ok || app.config.projectType !== projectType ||
            app.apps.find(profile => profile.id === app.active)?.projectType !== projectType) return false
        const check = await fetch('/api/preflight').then(response => response.json())
        if (!check.ok || check.checks[0]?.id !== 'project-config') return false
      }
      return true
    })()
  `)
  if (!typedApps) throw new Error('Android and Flutter profiles did not load their build checks')
  app.quit()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed() || stopping) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', (event) => {
    if (!backend) return
    event.preventDefault()
    if (stopping) return
    stopping = true
    backend.stdin.end()
    stopTimer = setTimeout(() => {
      exitCode = 1
      const killer = spawn('taskkill', ['/PID', String(backend.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      killer.on('error', () => backend?.kill())
      killer.on('close', () => backend?.kill())
    }, 30_000)
  })
  app.whenReady().then(openWindow).catch(fail)
}
