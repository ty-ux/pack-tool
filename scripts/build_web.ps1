# ============================================================
#  Web / H5 一键发行脚本
#  依赖: HBuilderX CLI（发行能力 publish web）
#  用法: powershell -ExecutionPolicy Bypass -File build_web.ps1 -Config "D:\path\to\config.json" -WebType h5
#        WebType: h5 (手机H5) / pc (网站-PC Web)
#  产物: 项目 unpackage\dist\build\web  ->  输出目录\build
# ============================================================
param(
    [string]$Config = "",
    [string]$WebType = "h5"    # h5 / pc
)

$ErrorActionPreference = "Stop"

# 让 Write-Host 输出 UTF-8 字节流（中文 Windows 默认 GBK，会导致 build.log 乱码）
try {
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
} catch {
    # 某些宿主环境不支持设置 OutputEncoding，忽略即可
}

function Write-Log {
    param([string]$Msg, [string]$Level = "INFO")
    $time = Get-Date -Format "HH:mm:ss"
    switch ($Level) {
        "OK"    { Write-Host "[$time] [OK]   $Msg" -ForegroundColor Green }
        "WARN"  { Write-Host "[$time] [WARN] $Msg" -ForegroundColor Yellow }
        "ERR"   { Write-Host "[$time] [ERR]  $Msg" -ForegroundColor Red }
        "STEP"  { Write-Host "`n[$time] ==== $Msg ====" -ForegroundColor Cyan }
        default { Write-Host "[$time] [INFO] $Msg" -ForegroundColor Gray }
    }
}

# ---------- 读取配置 ----------
if (-not $Config) {
    $Config = Join-Path $PSScriptRoot "..\config\pack_config.json"
}
if (-not (Test-Path $Config)) {
    Write-Log "配置文件不存在: $Config" "ERR"
    exit 1
}

try {
    $cfg = Get-Content $Config -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    Write-Log "配置文件解析失败: $_" "ERR"
    exit 1
}

Write-Log "已加载配置: $Config"
Write-Log "App名称: $($cfg.app.name) | 版本: $($cfg.app.versionName) ($($cfg.app.versionCode))"

# ---------- WebType 校验 ----------
$webType = $WebType.ToLower()
if ($webType -notin @("h5", "pc")) {
    Write-Log "无效的发行类型: $WebType (可选 h5/pc)" "ERR"
    exit 1
}
$webTypeLabel = if ($webType -eq "pc") { "网站-PC Web" } else { "手机H5" }
Write-Log "发行类型: $webTypeLabel"

# ---------- Web 配置（旧配置可能没有 web 节） ----------
$webCfg = $cfg.web
if (-not $webCfg) { $webCfg = @{} }
$webTitle   = $webCfg.webTitle
$webDomain  = $webCfg.webDomain
$ssrEnabled = [bool]$webCfg.ssr

# ---------- 路径解析 ----------
$hbxCli   = $cfg.paths.hbuilderxCli
$project  = $cfg.paths.projectDir

$mustExist = @(
    @{p=$hbxCli; d="HBuilderX CLI"},
    @{p=$project; d="uni-app 项目目录"}
)
foreach ($m in $mustExist) {
    if (-not (Test-Path $m.p)) {
        Write-Log "路径不存在: $($m.d) -> $($m.p)" "ERR"
        exit 1
    }
}

# 流水线步骤事件（供前端 Steps 展示解析）
# 格式: [STEP] <序号>|<key>|<名称>|<running|ok|fail>
function Write-Step {
    param([int]$Index, [string]$Key, [string]$Name, [string]$State)
    $time = Get-Date -Format "HH:mm:ss"
    Write-Host "[$time] [STEP] $Index|$Key|$Name|$State"
}

# ---------- 1. HBuilderX CLI 发行 Web ----------
Write-Log "步骤1/2: HBuilderX 发行 Web (publish web)..." "STEP"
Write-Step 1 "publish" "Web 发行" "running"
$webLog = Join-Path $PSScriptRoot "..\logs\web_build.log"
New-Item -ItemType Directory -Force -Path (Split-Path $webLog) | Out-Null

$cliArgs = @("publish", "web", "--project", $project)
if ($webTitle) {
    $cliArgs += @("--webTitle", $webTitle)
    Write-Log "网站标题: $webTitle"
}
if ($webDomain) {
    $cliArgs += @("--webDomain", $webDomain)
    Write-Log "网站域名: $webDomain"
}
if ($ssrEnabled) {
    $cliArgs += @("--ssr", "true")
    Write-Log "SSR: 已启用"
} else {
    Write-Log "SSR: 未启用"
}

# 记录发行开始时间，用于校验产物是否为本次新生成（CLI 退出码不可靠）
$publishStart = Get-Date
Write-Log "--- HBuilderX CLI 输出（实时） ---" "STEP"
$oldEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$cliLines = New-Object System.Collections.Generic.List[string]
try {
    & $hbxCli @cliArgs 2>&1 | ForEach-Object {
        $t = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { $_.ToString() }
        $cliLines.Add($t)
        Write-Host $t
    }
} finally {
    $ErrorActionPreference = $oldEAP
}
$cliOut = $cliLines -join "`r`n"
$cliOut | Set-Content $webLog -Encoding UTF8
$cliExit = $LASTEXITCODE

# 产物定位（uni-app H5 发行默认输出）: unpackage\dist\build\web
$distWeb = Join-Path $project "unpackage\dist\build\web"

# 判定有效的 Web 产物: 根 index.html（普通 H5）或 client\index.html（SSR 构建），
# 且必须为本次发行新生成（时间 >= 发行开始），避免拿旧产物假成功
function Test-WebDist {
    param($Root, $Since)
    if (-not $Root -or -not (Test-Path $Root)) { return $false }
    $landmark = $null
    foreach ($candidate in @((Join-Path $Root "index.html"), (Join-Path $Root "client\index.html"))) {
        $item = Get-Item $candidate -ErrorAction SilentlyContinue
        if ($item) { $landmark = $item; break }
    }
    return $landmark -and ($landmark.LastWriteTime -ge $Since)
}

$publishOk = ($cliExit -eq 0) -and (Test-WebDist $distWeb $publishStart)
# 仅当 CLI 退出码为 0 时才允许兜底查找产物（避免拿过期产物假成功）
if (-not $publishOk -and $cliExit -eq 0) {
    $found = Get-ChildItem -Path (Join-Path $project "unpackage\dist\build") -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-WebDist $_.FullName $publishStart } |
        Select-Object -First 1
    if ($found) {
        $distWeb = $found.FullName
        $publishOk = $true
    }
}

if ($publishOk) {
    Write-Log "Web 发行成功，产物: $distWeb" "OK"
    Write-Step 1 "publish" "Web 发行" "ok"
} else {
    Write-Log "Web 发行失败（退出码: $cliExit），日志: $webLog" "ERR"
    Write-Host $cliOut -ForegroundColor Red
    Write-Step 1 "publish" "Web 发行" "fail"
    exit 1
}

# 复制源: SSR 构建（存在 client\index.html 且根无 index.html）→ 静态站点为 client 目录；否则为整个 web 目录
$ssrBuild = (Test-Path (Join-Path $distWeb "client\index.html")) -and (-not (Test-Path (Join-Path $distWeb "index.html")))
if ($ssrBuild) {
    $copySrc = Join-Path $distWeb "client"
    Write-Log "检测到 SSR 构建，静态站点位于 client\ 目录，server\ 目录一并保留" "INFO"
} else {
    $copySrc = $distWeb
}

# ---------- 复制产物到输出目录 ----------
Write-Log "步骤2/2: 复制产物到输出目录..." "STEP"
Write-Step 2 "copy" "复制产物" "running"

# 输出目录优先级: paths.webOutputDir > paths.outputDir\build > 工具 output\build
$outDir = $cfg.paths.webOutputDir
if (-not $outDir) {
    if ($cfg.paths.outputDir) {
        $outDir = Join-Path $cfg.paths.outputDir "build"
    } else {
        $outDir = Join-Path $PSScriptRoot "..\output\build"
    }
}
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# 清空旧产物（避免残留文件），再用 robocopy /MIR 全量同步
Write-Log "清空旧产物: $outDir" "INFO"
Get-ChildItem -Path $outDir -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

Write-Log "正在复制 $copySrc -> $outDir ..." "INFO"
$robocopyOut = & robocopy $copySrc $outDir /MIR /NFL /NDL /NJH /NJS 2>&1 | Out-String

# robocopy 退出码 < 8 表示复制成功（0-7 均为正常）
if ($LASTEXITCODE -lt 8) {
    Write-Log "产物已复制到: $outDir" "OK"
    Write-Step 2 "copy" "复制产物" "ok"
} else {
    Write-Log "复制失败 (robocopy 退出码: $LASTEXITCODE)" "ERR"
    Write-Host $robocopyOut -ForegroundColor Red
    Write-Step 2 "copy" "复制产物" "fail"
    exit 1
}

# SSR 构建: 额外保留 server 目录（Node 服务端渲染包）
if ($ssrBuild) {
    $serverSrc = Join-Path $distWeb "server"
    if (Test-Path $serverSrc) {
        $serverDst = Join-Path $outDir "server"
        & robocopy $serverSrc $serverDst /MIR /NFL /NDL /NJH /NJS | Out-Null
        if ($LASTEXITCODE -lt 8) {
            Write-Log "已保留 SSR server 目录: $serverDst" "OK"
        }
    }
    Write-Log "SSR 提示: 静态部署用 output\build 根目录内容即可；如需服务端渲染，需将 server\ 部署到 Node 服务" "WARN"
}

$sizeMB = [math]::Round(((Get-ChildItem $outDir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 2)
Write-Log "Web 构建产物 ($webTypeLabel) 已生成: $outDir (约 ${sizeMB} MB)" "OK"

Write-Log "========== 全部完成 ==========" "OK"
Write-Log "BUILD-OK" "OK"
exit 0