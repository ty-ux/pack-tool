const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomBytes } = require('node:crypto')
const { spawn } = require('node:child_process')
const { Readable } = require('node:stream')

const REPO = 'ty-ux/pack-tool'
const API = `https://api.github.com/repos/${REPO}/releases/latest`
const ASSET = 'PackTool-win-x64.zip'
const MAX_ZIP = 1024 * 1024 * 1024

function versionParts(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value)
  if (!match || match.slice(1).some(part => !Number.isSafeInteger(Number(part)))) throw new Error('发布版本号无效')
  return match.slice(1).map(Number)
}

function newer(next, current) {
  const a = versionParts(next), b = versionParts(current)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

function releaseInfo(release, current) {
  if (release.draft || release.prerelease) throw new Error('未找到正式发布版本')
  const version = versionParts(release.tag_name).join('.')
  if (!newer(version, current)) return null
  const asset = release.assets?.find(item => item.name === ASSET && item.state === 'uploaded')
  if (!asset || !Number.isSafeInteger(asset.id) || asset.id <= 0 ||
      !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > MAX_ZIP ||
      !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) {
    throw new Error('该版本缺少可校验的 Windows 更新包，请稍后重试')
  }
  return { version, size: asset.size, sha256: asset.digest.slice(7),
    url: `https://api.github.com/repos/${REPO}/releases/assets/${asset.id}`,
    notes: String(release.body || '').slice(0, 12000) }
}

function trustedURL(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password &&
      !parsed.port && ['api.github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(parsed.hostname)
  } catch { return false }
}

// Electron fetch cancels manual redirects. ClientRequest lets us validate each
// redirect synchronously while keeping Chromium's system proxy support.
function createElectronFetch(net, session) {
  return (url, { signal, headers }) => new Promise((resolve, reject) => {
    if (!trustedURL(url)) return reject(new Error('更新下载地址不受信任'))
    if (signal?.aborted) return reject(signal.reason)
    const request = net.request({ url, session, method: 'GET', headers, redirect: 'manual', credentials: 'omit' })
    let response
    let redirects = 0
    const fail = error => { reject(error); response?.destroy(error); request.abort() }
    const abort = () => fail(signal.reason || new DOMException('Aborted', 'AbortError'))
    signal?.addEventListener('abort', abort, { once: true })
    request.on('redirect', (_status, _method, next) => {
      if (++redirects > 5 || !trustedURL(next)) { fail(new Error('更新服务器返回了不受信任的重定向')); return }
      request.followRedirect()
    })
    request.once('error', fail)
    request.once('close', () => signal?.removeEventListener('abort', abort))
    request.once('response', incoming => {
      response = incoming
      incoming.once('aborted', () => incoming.destroy(new Error('更新包下载中断，请重试')))
      const responseHeaders = new Headers()
      for (const [key, value] of Object.entries(incoming.headers)) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : String(value))
      const body = Readable.toWeb(incoming)
      resolve(new Response(body, { status: incoming.statusCode, headers: responseHeaders }))
    })
    request.end()
  })
}

// Redirects are checked individually; no tokens or cookies are needed for public releases.
async function githubFetch(url, { signal, binary = false, fetchImpl = fetch } = {}) {
  for (let redirects = 0; redirects < 6; redirects++) {
    if (!trustedURL(url)) throw new Error('更新服务器返回了不受信任的下载地址')
    const response = await fetchImpl(url, { signal, redirect: 'manual', credentials: 'omit',
      headers: { 'User-Agent': 'PackTool-Updater', Accept: binary ? 'application/octet-stream' : 'application/vnd.github+json' } })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) throw new Error('更新服务器未返回下载地址')
      url = new URL(location, url).href
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      if (response.status === 403 || response.status === 429) throw new Error('GitHub 暂时限流，请稍后再检查更新')
      throw new Error(`更新请求失败（HTTP ${response.status}）`)
    }
    return response
  }
  throw new Error('更新服务器重定向次数过多')
}

async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

function runHelper(script, plan, mode) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', script, '-PlanPath', plan, '-Mode', mode], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => { child.kill(); reject(new Error('准备更新超过 10 分钟，请检查更新日志')) }, 10 * 60_000)
    let errors = ''
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4000) })
    child.stdout.resume()
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('准备更新失败：' + errors.trim())) })
  })
}

class UpdateManager {
  constructor({ version, userData, installDir, executable, supported, log = () => {},
    fetchImpl = fetch, prepare = runHelper, canInstall = async () => true,
    launch = spawn, quit = () => {} }) {
    Object.assign(this, { version, userData, installDir, executable, supported, log, fetchImpl, prepare, canInstall, launch, quit })
    this.state = { currentVersion: version, supported, phase: 'idle', received: 0, total: 0, error: '' }
    this.root = path.join(userData, 'updates')
    this.resultFile = path.join(this.root, 'last-result.json')
    this.pendingFile = path.join(this.root, 'pending.json')
    this.readResult()
    if (supported) this.restorePending()
  }

  readResult() {
    try {
      const result = JSON.parse(fs.readFileSync(this.resultFile, 'utf8').replace(/^\uFEFF/, ''))
      this.state.lastResult = { ok: result.ok === true, message: String(result.message || '').slice(0, 2000),
        backup: String(result.backup || '').slice(0, 1000) }
    } catch { /* First launch has no update result. */ }
  }
  snapshot() { this.readResult(); return { ...this.state } }
  restorePending() {
    try {
      const { id } = JSON.parse(fs.readFileSync(this.pendingFile, 'utf8'))
      if (!/^[a-f0-9]{32}$/.test(id)) return
      const work = path.join(this.root, id)
      const planFile = path.join(work, 'plan.json')
      const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'))
      if (plan.id !== id || !newer(plan.version, this.version) ||
          plan.target !== fs.realpathSync(this.installDir) || !fs.existsSync(plan.stage) ||
          plan.zip !== path.join(work, 'update.zip') || !fs.existsSync(plan.zip)) return
      Object.assign(this, { plan, planFile, work, helper: path.join(work, 'apply-update.ps1') })
      this.release = { version: plan.version, size: fs.statSync(plan.zip).size, sha256: plan.sha256, notes: '' }
      this.set({ phase: 'ready', received: this.release.size, total: this.release.size,
        release: { version: plan.version, size: this.release.size, notes: '' } })
    } catch { /* Interrupted or obsolete packages can be downloaded again. */ }
  }
  set(patch) { Object.assign(this.state, patch) }
  assertAvailable() {
    if (!this.supported) throw new Error('此运行方式不支持程序内更新，请使用 Windows 桌面版')
    if (['checking', 'downloading', 'preparing', 'installing'].includes(this.state.phase)) throw new Error('更新操作正在进行')
  }
  fail(error) {
    const message = error.name === 'TimeoutError' || error.name === 'AbortError'
      ? '更新请求超时或已取消，请重试' : error.name === 'SyntaxError' ? '更新服务器返回了无效的版本信息，请稍后重试'
        : error.name === 'TypeError' ? '无法连接 GitHub，请检查网络后重试' : error.message || '更新失败，请检查更新日志'
    this.log('update.failed ' + message)
    this.set({ phase: 'error', error: message })
    return this.snapshot()
  }

  async check() {
    this.assertAvailable()
    if (this.state.phase === 'ready') return this.snapshot()
    this.set({ phase: 'checking', error: '', release: undefined, received: 0, total: 0 })
    this.log('update.check current=' + this.version)
    try {
      const response = await githubFetch(API, { signal: AbortSignal.timeout(20_000), fetchImpl: this.fetchImpl })
      const text = await response.text()
      if (text.length > 1024 * 1024) throw new Error('更新信息过大')
      this.release = releaseInfo(JSON.parse(text), this.version)
      this.set({ phase: this.release ? 'available' : 'latest', release: this.release ? {
        version: this.release.version, notes: this.release.notes, size: this.release.size,
      } : undefined })
      this.log('update.checked result=' + this.state.phase + (this.release ? ' version=' + this.release.version : ''))
      return this.snapshot()
    } catch (error) { return this.fail(error) }
  }

  async download() {
    this.assertAvailable()
    if (!this.release) throw new Error('请先检查更新')
    if (this.state.phase === 'ready') return this.snapshot()
    const id = randomBytes(16).toString('hex')
    this.work = path.join(this.root, id)
    this.set({ phase: 'downloading', error: '', received: 0, total: this.release.size })
    this.log('update.download version=' + this.release.version)
    this.controller = new AbortController()
    let idleTimer
    const resetIdle = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => this.controller.abort(), 60_000)
    }
    try {
      await fsp.mkdir(this.work, { recursive: true })
      const zip = path.join(this.work, 'update.zip')
      const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(20 * 60_000)])
      resetIdle()
      const response = await githubFetch(this.release.url, { signal, binary: true, fetchImpl: this.fetchImpl })
      if (!response.body) throw new Error('更新包为空')
      const hash = createHash('sha256')
      const stream = await fsp.open(zip, 'wx')
      try {
        for await (const chunk of response.body) {
          resetIdle()
          const received = this.state.received + chunk.byteLength
          if (received > this.release.size) throw new Error('更新包大小不符')
          hash.update(chunk)
          await stream.writeFile(chunk)
          this.set({ received })
        }
      } finally { await stream.close() }
      clearTimeout(idleTimer)
      if (this.state.received !== this.release.size || hash.digest('hex') !== this.release.sha256) throw new Error('更新包校验失败，请重新下载')
      this.log('update.verified version=' + this.release.version)
      this.set({ phase: 'preparing' })
      const target = await fsp.realpath(this.installDir)
      const data = await fsp.realpath(this.userData)
      const inside = (child, parent) => { const relative = path.relative(parent, child); return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)) }
      if (inside(data, target) || inside(target, data) || path.parse(target).root === target) throw new Error('程序目录与用户数据目录重叠，无法安全更新')
      const name = path.basename(target)
      const plan = { id, version: this.release.version, sha256: this.release.sha256, zip,
        target, stage: path.join(path.dirname(target), `.${name}.packtool-update-${id}`),
        backup: path.join(path.dirname(target), `.${name}.packtool-backup-${id}`),
        executable: path.basename(this.executable), oldPid: process.pid,
        ready: path.join(this.work, 'ready'), armed: path.join(this.work, 'armed'), result: this.resultFile,
        log: path.join(this.userData, 'logs', 'update.log') }
      this.planFile = path.join(this.work, 'plan.json')
      this.helper = path.join(this.work, 'apply-update.ps1')
      await fsp.copyFile(path.join(__dirname, 'apply-update.ps1'), this.helper)
      await fsp.writeFile(this.planFile, JSON.stringify(plan), 'utf8')
      await this.prepare(this.helper, this.planFile, 'Prepare')
      this.plan = plan
      await fsp.writeFile(this.pendingFile, JSON.stringify({ id }), 'utf8')
      this.set({ phase: 'ready' })
      this.log('update.ready version=' + plan.version)
      return this.snapshot()
    } catch (error) {
      this.controller.abort()
      // A failed package never changes the running installation. Helper owns stage cleanup.
      if (this.work) await fsp.rm(path.join(this.work, 'update.zip'), { force: true }).catch(() => {})
      return this.fail(error)
    } finally { clearTimeout(idleTimer); this.controller = null }
  }

  cancel() {
    if (this.state.phase === 'downloading') { this.log('update.cancel'); this.controller?.abort() }
    return this.snapshot()
  }

  async install() {
    this.assertAvailable()
    if (this.state.phase !== 'ready' || !this.plan) throw new Error('请先下载并验证更新包')
    if (!await this.canInstall()) { this.log('update.install_refused build_running'); throw new Error('构建任务正在运行，请完成或停止构建后再更新') }
    this.set({ phase: 'installing', error: '' })
    try {
      if (await hashFile(this.plan.zip) !== this.plan.sha256) throw new Error('更新包已改变，请重新下载')
      await fsp.rm(this.plan.armed, { force: true })
      const child = this.launch('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', this.helper, '-PlanPath', this.planFile, '-Mode', 'Install'], {
        windowsHide: true, detached: true, stdio: 'ignore', cwd: this.userData,
      })
      let launchError
      child.once('error', error => { launchError = error })
      // Do not quit until the helper has read and validated its plan.
      const deadline = Date.now() + 10_000
      while (!fs.existsSync(this.plan.armed)) {
        if (launchError) throw launchError
        if (child.exitCode !== null || Date.now() > deadline) throw new Error('无法启动更新程序，请检查 update.log')
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      child.unref()
      this.log('update.install version=' + this.plan.version)
      this.quit()
      return this.snapshot()
    } catch (error) {
      const changed = error.message.includes('更新包已改变')
      if (changed) {
        await fsp.rm(this.pendingFile, { force: true }).catch(() => {})
        this.release = null
      }
      this.set({ phase: changed ? 'error' : 'ready', error: error.message, ...(changed ? { release: undefined } : {}) })
      this.log('update.install_failed ' + error.message)
      return this.snapshot()
    }
  }
}

module.exports = { UpdateManager, versionParts, newer, releaseInfo, githubFetch, trustedURL, hashFile, createElectronFetch }
