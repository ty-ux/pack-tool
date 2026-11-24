const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { randomBytes, createHash } = require('node:crypto')
const { execFile, spawn } = require('node:child_process')
const { promisify } = require('node:util')
const exec = promisify(execFile)
const windows = process.platform === 'win32'
const python = process.env.PACK_TOOL_PYTHON || 'python'
const helper = path.join(__dirname, 'apply-update.ps1')

async function powershell(script, args = [], env = process.env) {
  return exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { windowsHide: true, env, timeout: 30_000 })
}

async function fixture(t, { malicious, failStart = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'packtool-install-test-'))
  const id = randomBytes(16).toString('hex')
  const target = path.join(root, 'program 中文 space')
  const data = path.join(root, 'user data')
  const work = path.join(data, 'updates', id)
  const stage = path.join(root, '.program 中文 space.packtool-update-' + id)
  const backup = path.join(root, '.program 中文 space.packtool-backup-' + id)
  await fs.mkdir(target, { recursive: true }); await fs.mkdir(work, { recursive: true })
  await fs.mkdir(path.join(data, 'logs')); await fs.writeFile(path.join(data, 'config.json'), 'keep config and credentials')
  await fs.writeFile(path.join(data, 'logs', 'application.log'), 'keep logs')
  await fs.writeFile(path.join(target, 'my-custom-file.txt'), 'keep custom program file in backup')
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }))
  const source = `using System; using System.IO; using System.Threading;
public class Program { public static int Main(string[] args) {
  var data = Environment.GetEnvironmentVariable("PACK_TOOL_UPDATE_TEST_DATA");
  var here = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
  if (File.Exists(Path.Combine(here, "fail-start"))) return 42;
  if (args.Length > 0 && args[0].StartsWith("--update-id=")) {
    File.WriteAllText(Path.Combine(data, "updates", args[0].Substring(12), "ready"), "2.7.0");
  } else { File.WriteAllText(Path.Combine(data, "old-started"), "yes"); }
  Thread.Sleep(1200); return 0;
} }`
  const csharp = path.join(root, 'fixture.cs')
  await fs.writeFile(csharp, source)
  const compile = path.join(root, 'compile.ps1')
  await fs.writeFile(compile, "param($Source, $Destination)\nAdd-Type -TypeDefinition (Get-Content -LiteralPath $Source -Raw) -OutputAssembly $Destination -OutputType ConsoleApplication\n")
  const exe = path.join(target, 'PackTool.exe')
  await powershell(compile, [csharp, exe])
  const archiveScript = `import json,sys,zipfile,pathlib
exe,out,malicious,fail=sys.argv[1:]
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
 z.write(exe,'PackTool-win32-x64/PackTool.exe')
 z.writestr('PackTool-win32-x64/resources/app.asar','new app')
 z.writestr('PackTool-win32-x64/resources/backend/pack-tool-backend.exe','new backend')
 z.writestr('PackTool-win32-x64/packtool-release.json',json.dumps(dict(version='2.7.0',platform='win32',arch='x64')))
 if malicious: z.writestr(malicious,'must not escape')
 if fail=='yes': z.writestr('PackTool-win32-x64/fail-start','yes')
`
  const zip = path.join(work, 'update.zip')
  await exec(python, ['-c', archiveScript, exe, zip, malicious || '', failStart ? 'yes' : 'no'], { windowsHide: true })
  const plan = { id, version: '2.7.0', sha256: createHash('sha256').update(await fs.readFile(zip)).digest('hex'), zip,
    target, stage, backup, executable: 'PackTool.exe', oldPid: 2147483646,
    ready: path.join(work, 'ready'), armed: path.join(work, 'armed'), result: path.join(data, 'updates', 'last-result.json'), log: path.join(data, 'logs', 'update.log') }
  const planFile = path.join(work, 'plan.json')
  await fs.writeFile(planFile, JSON.stringify(plan))
  const run = mode => powershell(helper, ['-PlanPath', planFile, '-Mode', mode], { ...process.env, PACK_TOOL_UPDATE_TEST_DATA: data })
  const dataIntact = async () => {
    assert.equal(await fs.readFile(path.join(data, 'config.json'), 'utf8'), 'keep config and credentials')
    assert.equal(await fs.readFile(path.join(data, 'logs', 'application.log'), 'utf8'), 'keep logs')
  }
  return { root, data, plan, planFile, run, dataIntact }
}

test('Windows helper installs through sibling renames, confirms startup and keeps user files and data', { skip: !windows }, async t => {
  const f = await fixture(t)
  await f.run('Prepare')
  assert.equal(await fs.readFile(path.join(f.plan.target, 'my-custom-file.txt'), 'utf8'), 'keep custom program file in backup')
  await f.run('Install')
  const result = JSON.parse(await fs.readFile(f.plan.result, 'utf8'))
  assert.equal(result.ok, true)
  assert.equal(await fs.readFile(path.join(f.plan.backup, 'my-custom-file.txt'), 'utf8'), 'keep custom program file in backup')
  assert.equal(await fs.readFile(path.join(f.plan.target, 'resources', 'app.asar'), 'utf8'), 'new app')
  await f.dataIntact()
})

test('Windows helper restores and restarts old program when the new process fails startup', { skip: !windows }, async t => {
  const f = await fixture(t, { failStart: true })
  await f.run('Prepare')
  await assert.rejects(f.run('Install'))
  assert.equal(JSON.parse(await fs.readFile(f.plan.result, 'utf8')).ok, false)
  assert.equal(await fs.readFile(path.join(f.plan.target, 'my-custom-file.txt'), 'utf8'), 'keep custom program file in backup')
  for (let tries = 0; tries < 30; tries++) {
    if (await fs.stat(path.join(f.data, 'old-started')).catch(() => null)) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.equal(await fs.readFile(path.join(f.data, 'old-started'), 'utf8'), 'yes')
  await f.dataIntact()
})

test('Windows helper rejects zip traversal, alternate streams, reserved names and case collisions', { skip: !windows }, async t => {
  for (const malicious of ['PackTool-win32-x64/../escape.txt', 'PackTool-win32-x64/C:evil',
    'PackTool-win32-x64/CON.txt', 'PackTool-win32-x64/packtool.exe']) {
    const f = await fixture(t, { malicious })
    await assert.rejects(f.run('Prepare'), /Unsafe archive path|Duplicate archive path/)
    await assert.rejects(fs.stat(f.plan.stage))
    assert.equal(await fs.readFile(path.join(f.plan.target, 'my-custom-file.txt'), 'utf8'), 'keep custom program file in backup')
    await f.dataIntact()
  }
})

test('Windows helper refuses modified archives and unsafe staging paths before touching the install', { skip: !windows }, async t => {
  const f = await fixture(t)
  await fs.appendFile(f.plan.zip, 'tampered')
  await assert.rejects(f.run('Prepare'), /checksum mismatch/)
  f.plan.stage = f.data
  await fs.writeFile(f.planFile, JSON.stringify(f.plan))
  await assert.rejects(f.run('Prepare'), /Unsafe update paths/)
  await f.dataIntact()
})

test('Windows helper keeps the old program when its folder cannot be renamed', { skip: !windows }, async t => {
  const f = await fixture(t)
  await f.run('Prepare')
  const lockScript = path.join(f.root, 'lock.ps1'), locked = path.join(f.root, 'locked')
  await fs.writeFile(lockScript, `param($Folder,$Ready)
Add-Type @'
using System; using System.Runtime.InteropServices;
public class FolderLock {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern IntPtr CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
}
'@
$handle = [FolderLock]::CreateFile($Folder, 1, 3, [IntPtr]::Zero, 3, 0x02000000, [IntPtr]::Zero)
if ($handle -eq [IntPtr]::new(-1)) { throw 'Cannot lock test directory' }
try { [IO.File]::WriteAllText($Ready,"ready"); Start-Sleep -Seconds 20 } finally { [void][FolderLock]::CloseHandle($handle) }
`)
  const lock = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', lockScript, f.plan.target, locked], { windowsHide: true, stdio: 'ignore' })
  try {
    for (let tries = 0; tries < 50 && !await fs.stat(locked).catch(() => null); tries++) await new Promise(resolve => setTimeout(resolve, 100))
    assert.ok(await fs.stat(locked))
    await assert.rejects(f.run('Install'))
    assert.equal(JSON.parse(await fs.readFile(f.plan.result, 'utf8')).ok, false)
    assert.equal(await fs.readFile(path.join(f.plan.target, 'my-custom-file.txt'), 'utf8'), 'keep custom program file in backup')
    await f.dataIntact()
  } finally { lock.kill(); await new Promise(resolve => lock.exitCode !== null ? resolve() : lock.once('close', resolve)) }
})
