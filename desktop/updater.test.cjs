const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { createHash } = require('node:crypto')
const { UpdateManager, releaseInfo, newer, trustedURL, githubFetch, createElectronFetch } = require('./updater.cjs')

const bytes = Buffer.from('simulated release archive')
const digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex')
function release(overrides = {}) {
  return { tag_name: 'v2.7.0', draft: false, prerelease: false, body: 'Release notes',
    assets: [{ id: 123, name: 'PackTool-win-x64.zip', state: 'uploaded', size: bytes.length, digest }], ...overrides }
}

async function fixture(t, handler) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'packtool-update-test-'))
  const userData = path.join(dir, 'data'), installDir = path.join(dir, 'program')
  await fs.mkdir(userData); await fs.mkdir(installDir)
  await fs.writeFile(path.join(installDir, 'original.txt'), 'old program')
  const server = http.createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }) })
  let prepared = 0
  const manager = new UpdateManager({ version: '2.6.2', userData, installDir,
    executable: path.join(installDir, 'PackTool.exe'), supported: true,
    fetchImpl: (url, options) => fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`, options),
    prepare: async (_helper, plan) => {
      prepared++
      const value = JSON.parse(await fs.readFile(plan, 'utf8'))
      // Hosted Windows TEMP can contain the RUNNER~1 alias; production canonicalizes it.
      assert.equal(path.dirname(value.stage), path.dirname(await fs.realpath(installDir)))
      assert.equal(value.target, await fs.realpath(installDir))
      await fs.mkdir(value.stage)
    },
  })
  return { manager, userData, installDir, prepared: () => prepared }
}

test('release selection rejects malformed versions, prereleases and missing checksums', () => {
  assert.equal(newer('2.10.0', '2.9.9'), true)
  assert.equal(newer('2.7.0', '2.7.0'), false)
  assert.equal(releaseInfo(release(), '2.7.0'), null)
  for (const value of [release({ tag_name: 'v2.7.0-beta' }), release({ prerelease: true }),
    release({ assets: [] }), release({ assets: [{ ...release().assets[0], digest: '' }] })]) {
    assert.throws(() => releaseInfo(value, '2.6.2'))
  }
  for (const url of ['http://api.github.com/a', 'https://evil.example/a', 'https://user:pass@api.github.com/a', 'https://api.github.com:8443/a']) assert.equal(trustedURL(url), false)
})

test('real HTTP check and download validate hash before preparing, leaving old files intact', async t => {
  const calls = []
  const f = await fixture(t, (req, res) => {
    calls.push(req.url)
    if (req.url.endsWith('/latest')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(release())) }
    else res.end(bytes)
  })
  assert.equal((await f.manager.check()).phase, 'available')
  const downloaded = await f.manager.download()
  assert.equal(downloaded.phase, 'ready', downloaded.error)
  assert.equal(f.prepared(), 1)
  assert.deepEqual(calls, ['/repos/ty-ux/pack-tool/releases/latest', '/repos/ty-ux/pack-tool/releases/assets/123'])
  assert.equal(await fs.readFile(path.join(f.installDir, 'original.txt'), 'utf8'), 'old program')
  f.manager.canInstall = async () => false
  await assert.rejects(f.manager.install(), /构建任务/)
  assert.equal(f.manager.snapshot().phase, 'ready')
})

test('GitHub rate limits and HTML errors give retryable state without changing the install', async t => {
  const f = await fixture(t, (_req, res) => { res.writeHead(429); res.end('<html>rate limited</html>') })
  const state = await f.manager.check()
  assert.equal(state.phase, 'error'); assert.match(state.error, /限流/)
  assert.equal(f.prepared(), 0)
})

test('bad checksum and interrupted HTTP body never prepare an installation', async t => {
  for (const interrupted of [false, true]) {
    const f = await fixture(t, (req, res) => {
      if (req.url.endsWith('/latest')) res.end(JSON.stringify(release()))
      else if (interrupted) { res.writeHead(200, { 'Content-Length': bytes.length }); res.write(bytes.subarray(0, 2)); setTimeout(() => res.destroy(), 10) }
      else res.end(Buffer.alloc(bytes.length, 'x'))
    })
    await f.manager.check()
    assert.equal((await f.manager.download()).phase, 'error')
    assert.equal(f.prepared(), 0)
    await assert.rejects(fs.stat(path.join(f.manager.work, 'update.zip')))
    assert.equal(await fs.readFile(path.join(f.installDir, 'original.txt'), 'utf8'), 'old program')
  }
})

test('cancel a live download, then retry successfully', async t => {
  let slow = true
  let started
  const bodyStarted = new Promise(resolve => { started = resolve })
  const f = await fixture(t, (req, res) => {
    if (req.url.endsWith('/latest')) res.end(JSON.stringify(release()))
    else if (slow) { res.write(bytes.subarray(0, 2)); started() }
    else res.end(bytes)
  })
  await f.manager.check()
  const downloading = f.manager.download()
  await bodyStarted
  await assert.rejects(f.manager.check(), /正在进行/)
  f.manager.cancel()
  assert.equal((await downloading).phase, 'error')
  slow = false
  assert.equal((await f.manager.download()).phase, 'ready')
})

test('reject external redirects without requesting the untrusted host', async () => {
  let calls = 0
  await assert.rejects(githubFetch('https://api.github.com/x', { fetchImpl: async () => {
    calls++; return new Response(null, { status: 302, headers: { location: 'https://evil.example/archive.zip' } })
  } }), /不受信任/)
  assert.equal(calls, 1)
})

test('no newer version and unsupported runtime never attempt a download', async t => {
  const f = await fixture(t, (_req, res) => res.end(JSON.stringify(release({ tag_name: 'v2.6.1' }))))
  assert.equal((await f.manager.check()).phase, 'latest')
  f.manager.supported = false
  await assert.rejects(f.manager.check(), /Windows 桌面版/)
})

test('failed helper launch keeps the application open and the ready package retryable', async t => {
  const f = await fixture(t, (req, res) => res.end(req.url.endsWith('/latest') ? JSON.stringify(release()) : bytes))
  await f.manager.check(); await f.manager.download()
  const { EventEmitter } = require('node:events')
  f.manager.launch = () => { const child = new EventEmitter(); child.exitCode = null; process.nextTick(() => child.emit('error', new Error('helper blocked'))); return child }
  let quit = false
  f.manager.quit = () => { quit = true }
  assert.equal((await f.manager.install()).phase, 'ready')
  assert.match(f.manager.snapshot().error, /helper blocked/)
  assert.equal(quit, false)
})

test('a verified pending download survives restart and a changed archive cannot be installed', async t => {
  const f = await fixture(t, (req, res) => res.end(req.url.endsWith('/latest') ? JSON.stringify(release()) : bytes))
  await f.manager.check(); await f.manager.download()
  const restarted = new UpdateManager({ version: '2.6.2', userData: f.userData, installDir: f.installDir,
    executable: path.join(f.installDir, 'PackTool.exe'), supported: true })
  assert.equal(restarted.snapshot().phase, 'ready')
  await fs.appendFile(restarted.plan.zip, 'tampered')
  assert.equal((await restarted.install()).phase, 'error')
  assert.match(restarted.snapshot().error, /已改变/)
  await assert.rejects(fs.stat(restarted.pendingFile))
})

test('installing a pending package after restart waits for the current application PID', async t => {
  const f = await fixture(t, (req, res) => res.end(req.url.endsWith('/latest') ? JSON.stringify(release()) : bytes))
  await f.manager.check(); await f.manager.download()
  f.manager.plan.oldPid = 2147483646
  await fs.writeFile(f.manager.planFile, JSON.stringify(f.manager.plan))
  const restarted = new UpdateManager({ version: '2.6.2', userData: f.userData, installDir: f.installDir,
    executable: path.join(f.installDir, 'PackTool.exe'), supported: true,
    launch: () => {
      const plan = JSON.parse(require('node:fs').readFileSync(restarted.planFile, 'utf8'))
      assert.equal(plan.oldPid, process.pid)
      throw new Error('test ends before spawning helper')
    },
  })
  assert.equal((await restarted.install()).phase, 'ready')
  assert.match(restarted.snapshot().error, /test ends/)
})

test('Electron transport follows trusted redirects synchronously and streams the response', async () => {
  const { EventEmitter } = require('node:events')
  const { Readable } = require('node:stream')
  let followed = false
  const request = new EventEmitter()
  request.abort = () => request.emit('close')
  request.followRedirect = () => { followed = true }
  request.end = () => {
    request.emit('redirect', 302, 'GET', 'https://release-assets.githubusercontent.com/file')
    assert.equal(followed, true)
    const response = Readable.from([Buffer.from('archive')])
    Object.assign(response, { statusCode: 200, headers: { 'content-type': ['application/zip'] } })
    request.emit('response', response)
  }
  const transport = createElectronFetch({ request: options => { assert.equal(options.credentials, 'omit'); return request } }, {})
  assert.equal(await (await transport('https://api.github.com/file', { headers: {} })).text(), 'archive')
})

test('Electron transport aborts untrusted redirects and active response streams', async () => {
  const { EventEmitter } = require('node:events')
  const { Readable } = require('node:stream')
  const request = new EventEmitter()
  let aborted = false
  request.abort = () => { aborted = true; request.emit('close') }
  request.followRedirect = () => assert.fail('Must not follow unsafe redirect')
  request.end = () => request.emit('redirect', 302, 'GET', 'https://evil.example/file')
  const transport = createElectronFetch({ request: () => request }, {})
  await assert.rejects(transport('https://api.github.com/file', { headers: {} }), /不受信任/)
  assert.equal(aborted, true)
  const controller = new AbortController()
  request.end = () => {
    const response = new Readable({ read() {} })
    Object.assign(response, { statusCode: 200, headers: {} })
    request.emit('response', response)
  }
  const response = await transport('https://api.github.com/file', { headers: {}, signal: controller.signal })
  const body = response.text()
  controller.abort()
  await assert.rejects(body, /abort/i)
})
