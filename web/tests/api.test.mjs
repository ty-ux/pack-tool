import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
const { api, syncPackages, downloadPackageSyncLog } = await import(
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
