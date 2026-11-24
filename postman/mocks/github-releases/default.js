// Local test fixture from GitHub's Releases/Assets contract; never deployed.
const http = require('node:http')
let scenario = 'rate-limit'
http.createServer((req, res) => {
  const route = new URL(req.url, 'http://localhost').pathname
  if (req.method === 'POST' && route.startsWith('/scenario/')) {
    scenario = route.slice('/scenario/'.length)
    return res.end('{}')
  }
  if (req.method !== 'GET' || route !== '/repos/ty-ux/pack-tool/releases/latest') {
    res.writeHead(501); return res.end('Endpoint not modeled')
  }
  if (scenario === 'rate-limit') { res.writeHead(403, { 'x-ratelimit-remaining': '0' }); return res.end('{"message":"API rate limit exceeded"}') }
  if (scenario === 'html-error') { res.writeHead(502, { 'Content-Type': 'text/html' }); return res.end('<html>upstream unavailable</html>') }
  if (scenario === 'invalid-json') return res.end('<html>not release metadata</html>')
  if (scenario === 'timeout') return // The test aborts its real HTTP request.
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ tag_name: 'v2.6.2', draft: false, prerelease: false, assets: [], body: '' }))
}).listen(process.env.PORT || 8897, '127.0.0.1')
