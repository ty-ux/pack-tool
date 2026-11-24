// Start the local Postman simulation first. No production URL override is exposed.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { UpdateManager } = require('./updater.cjs')

async function run() {
  const origin = process.argv[2] || 'http://127.0.0.1:8897/github'
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'packtool-postman-'))
  try {
    const manager = new UpdateManager({ version: '2.6.2', userData: root, supported: true,
      fetchImpl: (url, options) => fetch(origin + new URL(url).pathname, { ...options,
        signal: AbortSignal.any([options.signal, AbortSignal.timeout(250)]) }),
    })
    for (const scenario of ['rate-limit', 'html-error', 'invalid-json', 'timeout', 'latest']) {
      const response = await fetch(origin + '/scenario/' + scenario, { method: 'POST' })
      assert.equal(response.ok, true)
      const state = await manager.check()
      assert.equal(state.phase, scenario === 'latest' ? 'latest' : 'error')
      if (scenario === 'rate-limit') assert.match(state.error, /限流/)
      if (scenario === 'timeout') assert.match(state.error, /超时/)
      console.log(scenario + ': ' + state.phase)
    }
  } finally { await fs.rm(root, { recursive: true, force: true }) }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
