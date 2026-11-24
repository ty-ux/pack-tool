import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
const { api, syncPackages, downloadPackageSyncLog, downloadDiagnostics, reportClientEvent, flushClientEvents } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

test('sync business failure preserves the detailed result', async (t) => {
  const payload = { ok: false, error: 'missing source', results: [{ action: 'error' }], summary: { error: 1 } }
  t.mock.method(globalThis, 'fetch', async () => Response.json(payload))
  assert.deepEqual(await syncPackages(), payload)
})

test('ordinary API business failures still throw', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: false, error: 'save failed' }))
  await assert.rejects(api.post('/api/packages'), /save failed/)
})

test('sync HTTP and network failures still throw', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ detail: 'bad request' }, { status: 400 }))
  await assert.rejects(syncPackages(), /bad request/)
  fetch.mock.mockImplementation(async () => { throw new TypeError('offline') })
  await assert.rejects(syncPackages(), /无法连接服务/)
})

test('sync log download handles a missing log and returns file contents', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ detail: '暂无日志' }, { status: 404 }))
  await assert.rejects(downloadPackageSyncLog(), /暂无日志/)
  fetch.mock.mockImplementation(async () => new Response('diagnostic log'))
  assert.equal(await (await downloadPackageSyncLog()).text(), 'diagnostic log')
})

test('failed API response exposes the correlation ID without changing success responses', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: false, error: 'save failed' }, {
    headers: { 'X-Request-ID': '1234567890abcdef' },
  }))
  await assert.rejects(api.post('/api/config'), (error) => {
    assert.match(error.message, /日志编号：1234567890abcdef/)
    assert.equal(error.requestId, '1234567890abcdef')
    return true
  })
})

test('client reports contain safe categories and script locations without error messages', async (t) => {
  const reports = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url === '/api/diagnostics/events') reports.push(JSON.parse(init.body))
    return Response.json({ ok: true })
  })
  const error = new TypeError('storePassword=must-not-leak')
  error.stack = 'TypeError: storePassword=must-not-leak\n at function (http://localhost/assets/app-hash.js:10:20)'
  reportClientEvent('javascript', 'runtime', '', error)
  // Reporting is asynchronous and uses a separate, non-recursive fetch path.
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(reports.at(-1).errorType, 'TypeError')
  assert.equal(reports.at(-1).location, 'app-hash.js:10:20')
  assert.equal(JSON.stringify(reports).includes('must-not-leak'), false)
})

test('diagnostic reporting failure never replaces an operation and can flush after recovery', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('offline') })
  reportClientEvent('network', 'request')
  await new Promise(resolve => setTimeout(resolve, 0))
  fetch.mock.mockImplementation(async () => Response.json({ ok: true }))
  await flushClientEvents()
  assert.equal(fetch.mock.calls.at(-1).arguments[0], '/api/diagnostics/events')
})

test('diagnostic ZIP download returns the archive or a correlated error', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('zip fixture'))
  assert.equal(await (await downloadDiagnostics()).text(), 'zip fixture')
  fetch.mock.mockImplementation(async () => new Response('', { status: 500, headers: { 'X-Request-ID': '1234567890abcdef' } }))
  await assert.rejects(downloadDiagnostics(), /日志编号：1234567890abcdef/)
})
