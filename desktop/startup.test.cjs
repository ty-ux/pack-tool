const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { setTimeout: delay } = require('node:timers/promises')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createStartupLog, waitForPort } = require('./startup.cjs')

function child() {
  return Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() })
}

test('upgrade progress keeps startup alive beyond the original idle deadline', async () => {
  const backend = child()
  const ready = waitForPort(backend, () => {}, { idleMs: 200, maxMs: 3000 })
  for (let i = 0; i < 4; i++) {
    backend.stdout.write('{"event":"startup-progress","stage":"preparing-data"}\n')
    await delay(80)
  }
  backend.stdout.write('{"port":8765}\n')
  assert.equal(await ready, 8765)
})

test('a silent backend fails with stderr for diagnosis', async () => {
  const backend = child()
  const ready = waitForPort(backend, () => {}, { idleMs: 10, maxMs: 1000 })
  backend.stderr.write('disk full')
  await assert.rejects(ready, /超时。disk full/)
})

test('progress cannot keep a hung backend alive indefinitely', async () => {
  const backend = child()
  const ready = waitForPort(backend, () => {}, { idleMs: 1000, maxMs: 20 })
  backend.stdout.write('{"event":"startup-progress","stage":"preparing-data"}\n')
  await assert.rejects(ready, /超过 15 分钟/)
})

test('startup exit includes backend error and rejects invalid readiness', async () => {
  const backend = child()
  const ready = waitForPort(backend)
  backend.stderr.write('backup failed')
  backend.emit('close', 1)
  await assert.rejects(ready, /本地服务退出（1）。backup failed/)
  const invalid = child()
  const invalidReady = waitForPort(invalid)
  invalid.stdout.write('{"port":0}\n')
  await assert.rejects(invalidReady, /无效端口/)
})

test('backend errors are saved to the startup log and old logs rotate', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'packtool-startup-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'startup.log')
  fs.writeFileSync(file, Buffer.alloc(2 * 1024 * 1024, 'x'))
  const log = createStartupLog(directory)
  const backend = child()
  const ready = waitForPort(backend, log.write)
  backend.stderr.write('failed to back up existing data')
  backend.emit('close', 1)
  await assert.rejects(ready, /failed to back up/)
  assert.match(fs.readFileSync(file, 'utf8'), /failed to back up existing data/)
  assert.equal(fs.statSync(file + '.1').size, 2 * 1024 * 1024)
})
