const { createInterface } = require('node:readline')
const { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } = require('node:fs')
const path = require('node:path')

function createStartupLog(directory, name = 'startup.log') {
  mkdirSync(directory, { recursive: true })
  const file = path.join(directory, name)
  if (existsSync(file) && statSync(file).size >= 2 * 1024 * 1024) {
    rmSync(file + '.1', { force: true })
    renameSync(file, file + '.1')
  }
  return { file, write(message) {
    try { appendFileSync(file, new Date().toISOString() + ' ' + message + '\n', 'utf8') }
    catch (error) { console.error('Cannot write startup log:', error.message) }
  } }
}

function waitForPort(child, log = () => {}, { idleMs = 30_000, maxMs = 15 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const lines = createInterface({ input: child.stdout })
    let stderr = ''
    let idleTimer
    let maxTimer
    let settled = false
    let stage = '等待本地服务'
    function finish(error, port) {
      if (settled) return
      settled = true
      clearTimeout(idleTimer)
      clearTimeout(maxTimer)
      lines.close()
      child.removeListener('error', onError)
      child.removeListener('close', onClose)
      if (error) reject(error)
      else resolve(port)
    }
    function resetIdle() {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => finish(new Error(stage + '超时。' + stderr)), idleMs)
    }
    const onError = (error) => finish(error)
    const onClose = (code) => finish(new Error('本地服务退出（' + code + '）。' + stderr))
    child.stderr.setEncoding('utf8')
    // Keep stderr draining and recorded after readiness, including runtime crashes.
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-3000)
      log(chunk.trimEnd())
    })
    lines.on('line', (line) => {
      if (settled) return
      try {
        const message = JSON.parse(line)
        if (message.event === 'startup-progress' && message.stage === 'preparing-data') {
          stage = '准备用户数据（含升级备份）'
          log(stage)
          resetIdle()
          return
        }
        if (!Number.isInteger(message.port) || message.port < 1 || message.port > 65535) {
          throw new Error('本地服务返回了无效端口。')
        }
        log('Local service ready on port ' + message.port)
        finish(null, message.port)
      } catch (error) { finish(error) }
    })
    child.once('error', onError)
    child.once('close', onClose)
    resetIdle()
    maxTimer = setTimeout(() => finish(new Error(stage + '超过 15 分钟，请检查启动日志。' + stderr)), maxMs)
  })
}

module.exports = { createStartupLog, waitForPort }
