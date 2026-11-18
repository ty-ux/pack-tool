const fs = require('node:fs')
const path = require('node:path')

async function main() {
  const job = JSON.parse(process.env.PACK_TOOL_WECHAT_JOB)
  delete process.env.PACK_TOOL_WECHAT_JOB
  const lookup = [process.cwd(), path.dirname(process.execPath)]
  if (process.env.APPDATA) lookup.push(path.join(process.env.APPDATA, 'npm'))
  if (process.env.NPM_CONFIG_PREFIX) {
    lookup.push(process.env.NPM_CONFIG_PREFIX, path.join(process.env.NPM_CONFIG_PREFIX, 'lib'))
  }
  lookup.push(path.join(path.dirname(process.execPath), '..', 'lib'))

  let entry
  try {
    entry = require.resolve('miniprogram-ci', { paths: lookup })
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error
    throw new Error('找不到微信官方 miniprogram-ci，请在本机执行 npm install -g miniprogram-ci，或在项目中安装此依赖。')
  }

  const ci = require(entry)
  const project = new ci.Project({
    appid: job.appid,
    projectPath: job.projectPath,
    privateKeyPath: job.privateKeyPath,
    type: 'miniProgram',
    ignores: ['node_modules/**/*', '**/*.key', '**/*.pem'],
  })
  const options = {
    project,
    desc: job.description,
    setting: { useProjectConfig: true },
  }
  if (job.action === 'upload') {
    await ci.upload({ ...options, version: job.version })
    console.log('微信公众平台已收到开发版本。')
    return
  }

  fs.mkdirSync(path.dirname(job.artifact), { recursive: true })
  const scratch = fs.mkdtempSync(path.join(path.dirname(job.artifact), '.wechat-'))
  const partial = path.join(scratch, path.basename(job.artifact))
  try {
    if (job.action === 'preview') {
      await ci.preview({ ...options, qrcodeFormat: 'image', qrcodeOutputDest: partial })
    } else {
      await ci.getCompiledResult({ ...options, version: job.version }, partial)
    }
    fs.renameSync(partial, job.artifact)
  } finally {
    fs.rmSync(partial, { force: true })
    fs.rmdirSync(scratch)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
