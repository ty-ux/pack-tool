const { app, BrowserWindow, dialog } = require('electron')
const { spawn } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { mkdirSync } = require('node:fs')
const path = require('node:path')
const { createStartupLog, waitForPort } = require('./startup.cjs')

const smokeTest = process.argv.includes('--smoke-test')
if (smokeTest && process.env.PACK_TOOL_SMOKE_DIR) {
  app.setPath('userData', process.env.PACK_TOOL_SMOKE_DIR)
}

let backend
let mainWindow
let stopping = false
let exitCode = 0
let stopTimer
let startupLog

function fail(error) {
  exitCode = 1
  console.error(error)
  startupLog?.write(error.stack || error.message)
  if (!smokeTest) {
    dialog.showErrorBox('PackTool 启动失败', error.message + (startupLog ? '\n\n启动日志：' + startupLog.file : ''))
  }
  if (backend) app.quit()
  else app.exit(exitCode)
}

async function openWindow() {
  startupLog = createStartupLog(path.join(app.getPath('userData'), 'logs'))
  startupLog.write('Starting PackTool ' + app.getVersion())
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
  const origin = 'http://127.0.0.1:' + await waitForPort(backend, startupLog.write)
  if (stopping) return

  mainWindow = new BrowserWindow({
    icon: app.isPackaged ? path.join(app.getAppPath(), 'pack-tool.ico') : path.join(__dirname, 'assets', 'pack-tool.ico'),
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
  const discoveredJdk = await contents.executeJavaScript(`
    fetch('/api/local-tools').then(response => response.json()).then(result =>
      result.ok && result.tools.javaHome.find(candidate => candidate.source === 'JAVA_HOME')?.path
    )
  `)
  if (typeof discoveredJdk !== 'string' ||
      path.normalize(discoveredJdk).toLowerCase() !== path.normalize(process.env.JAVA_HOME).toLowerCase()) {
    throw new Error('PackTool did not discover the test JDK')
  }
  const typedApps = await contents.executeJavaScript(`
    (async () => {
      for (const projectType of ['android', 'flutter', 'react-native']) {
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
  if (!typedApps) throw new Error('Project profiles did not load their build checks')
  const built = await contents.executeJavaScript(`
    (async () => {
      const request = (route, body) => fetch('/api/' + route, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      }).then(response => response.json())
      const profile = await request('apps', { name: 'stdin regression', projectType: 'flutter' })
      profile.config.paths.projectDir = ${JSON.stringify(process.env.PACK_TOOL_SMOKE_PROJECT)}
      profile.config.paths.flutterCli = ${JSON.stringify(path.join(process.env.PACK_TOOL_SMOKE_PROJECT, 'flutter.bat'))}
      if (!(await request('config', { config: profile.config })).ok) return false
      if (!(await request('build', { platform: 'apk' })).ok) return false
      const deadline = Date.now() + 15_000
      while ((await request('status')).running) {
        if (Date.now() >= deadline) {
          await request('build/cancel', {})
          return false
        }
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      const { log } = await request('logs')
      return log.includes('PACKTOOL-CHILD-EOF') && log.includes('BUILD-OK')
    })()
  `)
  if (!built) throw new Error('Desktop build inherited the live shutdown pipe or failed to collect its artifact')
  const protectedPasswords = await contents.executeJavaScript(`
    (async () => {
      const profile = await fetch('/api/apps').then(response => response.json())
      profile.config.signing.passwordMode = 'local'
      profile.config.signing.storePassword = 'packtool smoke store password'
      profile.config.signing.keyPassword = 'packtool smoke key password'
      const saved = await fetch('/api/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: profile.config }),
      }).then(response => response.json())
      const signing = saved.config?.signing
      if (!saved.ok || signing.storePassword || signing.keyPassword ||
          !signing.storePasswordEncrypted?.startsWith('dpapi:') ||
          !signing.keyPasswordEncrypted?.startsWith('dpapi:')) return false
      const reloaded = await fetch('/api/apps').then(response => response.json())
      return reloaded.config.signing.storePasswordEncrypted === signing.storePasswordEncrypted &&
        !JSON.stringify(reloaded).includes('packtool smoke store password') &&
        !JSON.stringify(reloaded).includes('packtool smoke key password')
    })()
  `)
  if (!protectedPasswords) throw new Error('Local signing passwords were not encrypted before saving')
  const sharedKeys = await contents.executeJavaScript(`
    (async () => {
      const request = async (route, method = 'GET', body) => {
        const response = await fetch('/api/' + route, {
          method, headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        })
        return { status: response.status, cache: response.headers.get('Cache-Control'), data: await response.json() }
      }
      const profile = (await request('apps')).data
      const signing = { ...profile.config.signing,
        keystorePath: ${JSON.stringify(path.join(process.env.PACK_TOOL_SMOKE_PROJECT, 'fixture.jks'))},
        keyAlias: 'fixture',
      }
      const saved = (await request('signing-keys', 'POST', { name: 'shared smoke key', signing })).data
      if (!saved.ok || !saved.key?.id || saved.key.signing.storePassword) return false
      const id = saved.key.id
      profile.config.signing = { keyId: id }
      if (!(await request('config', 'POST', { config: profile.config })).data.ok) return false
      const reloaded = (await request('apps')).data.config.signing
      if (reloaded.keyId !== id || reloaded.storePasswordEncrypted) return false
      const listed = await request('signing-keys')
      if (listed.cache !== 'no-store' || listed.data.keys.find(key => key.id === id)?.usedBy.length !== 1) return false
      const revealed = await request('signing-keys/' + id + '/reveal', 'POST', {})
      if (revealed.cache !== 'no-store' || revealed.data.storePassword !== 'packtool smoke store password') return false
      if ((await request('signing-keys/' + id, 'DELETE')).status !== 400) return false
      profile.config.signing = {}
      if (!(await request('config', 'POST', { config: profile.config })).data.ok) return false
      return (await request('signing-keys/' + id, 'DELETE')).data.ok
    })()
  `)
  if (!sharedKeys) throw new Error('Shared signing profile selection, encryption or usage protection failed')
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
