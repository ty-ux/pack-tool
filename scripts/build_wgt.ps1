# ============================================================
#  WGT 热更新包制作脚本
#  依赖: HBuilderX CLI（发行能力 publish app --type wgt）
#  用法: powershell -ExecutionPolicy Bypass -File build_wgt.ps1 -Config "D:\path\to\config.json"
#  产物: 项目 unpackage\release\<AppID>.wgt  ->  输出目录\<App名>-v<版本>.wgt
# ============================================================
param(
    [string]$Config = ""
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

# ---------- 路径解析 ----------
$hbxCli  = $cfg.paths.hbuilderxCli
$project = $cfg.paths.projectDir
$appId = ([string]$cfg.app.appid).Trim()
if ($appId -notmatch '^[A-Za-z0-9_-]+$') {
    Write-Log "请填写 manifest.json 中的 AppID（字母、数字、下划线或连字符）" "ERR"
    exit 1
}

$mustExist = @(
    @{p=$hbxCli;  d="HBuilderX CLI"},
    @{p=$project; d="uni-app 项目目录"}
)
foreach ($m in $mustExist) {
    if (-not $m.p -or -not (Test-Path -LiteralPath $m.p)) {
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

# ---------- 0. 同步版本号到项目 manifest.json ----------
# HBuilderX CLI 打 wgt 读的是项目 manifest.json 的 versionName/versionCode，
# 与 build_apk.ps1（写 gradle）保持一致：以 config 为唯一版本源写回，
# 避免出现"文件名 v1.0.0、包内还是旧版本号"的错位导致 App 安装失败
Write-Log "步骤0/3: 同步版本到项目 manifest.json..." "STEP"
$manifestPath = Join-Path $project "manifest.json"
try {
    $manifestRaw = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $manifestRaw.versionName = [string]$cfg.app.versionName
    $manifestRaw.versionCode = [int]$cfg.app.versionCode
    $manifestJson = $manifestRaw | ConvertTo-Json -Depth 20
    # UTF-8 无 BOM 写回（HBuilderX CLI 可正常解析，键顺序变化无影响）
    [System.IO.File]::WriteAllText($manifestPath, $manifestJson, (New-Object System.Text.UTF8Encoding($false)))
    Write-Log "manifest 版本已同步: v$($cfg.app.versionName)($($cfg.app.versionCode))" "OK"
    Write-Step 0 "version-sync" "同步版本号" "ok"
} catch {
    Write-Log "同步 manifest 版本失败: $_" "ERR"
    Write-Step 0 "version-sync" "同步版本号" "fail"
    exit 1
}

# ---------- 1. HBuilderX CLI 制作 WGT 包 ----------
Write-Log "步骤1/3: HBuilderX 制作 WGT 包 (publish app --type wgt)..." "STEP"
Write-Step 1 "publish" "制作 WGT 包" "running"
$wgtLog = Join-Path $PSScriptRoot "..\logs\wgt_build.log"
New-Item -ItemType Directory -Force -Path (Split-Path $wgtLog) | Out-Null

$cliArgs = @("publish", "app", "--type", "wgt", "--project", $project)

# 记录制作开始时间，用于校验产物是否为本次新生成（CLI 退出码不可靠）
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
$cliOut | Set-Content $wgtLog -Encoding UTF8
$cliExit = $LASTEXITCODE

# 产物定位（默认导出）: 项目 unpackage\release\<AppID>.wgt
$releaseDir = Join-Path $project "unpackage\release"

# 判定有效的 WGT 产物: 存在 .wgt 文件且为本次制作新生成（时间 >= 制作开始）
$wgtFile = Get-Item -LiteralPath (Join-Path $releaseDir "$appId.wgt") -ErrorAction SilentlyContinue

$publishOk = ($cliExit -eq 0) -and $wgtFile -and ($wgtFile.LastWriteTime -ge $publishStart)

if ($publishOk) {
    Write-Log "WGT 制作成功，产物: $($wgtFile.FullName)" "OK"
    Write-Step 1 "publish" "制作 WGT 包" "ok"
} else {
    Write-Log "WGT 制作失败（退出码: $cliExit），日志: $wgtLog" "ERR"
    Write-Log "请确认 AppID 与项目 manifest.json 一致，且本次构建生成了 $appId.wgt" "WARN"
    Write-Host $cliOut -ForegroundColor Red
    Write-Step 1 "publish" "制作 WGT 包" "fail"
    exit 1
}

# ---------- 2. 复制产物到输出目录 ----------
Write-Log "步骤2/3: 复制产物到输出目录..." "STEP"
Write-Step 2 "copy" "复制产物" "running"

$outDir = $cfg.paths.outputDir
if (-not $outDir) {
    $outDir = Join-Path $PSScriptRoot "..\output"
}
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$outName = "$($cfg.app.name)-v$($cfg.app.versionName).wgt"
$outName = $outName -replace '[\\/:*?"<>|]', '_'
$destWgt = Join-Path $outDir $outName
Copy-Item $wgtFile.FullName $destWgt -Force
if (-not (Test-Path $destWgt)) {
    Write-Log "复制产物失败: $destWgt" "ERR"
    Write-Step 2 "copy" "复制产物" "fail"
    exit 1
}

$sizeMB = [math]::Round((Get-Item $destWgt).Length / 1MB, 2)
Write-Log "WGT 已复制到: $destWgt" "OK"
Write-Step 2 "copy" "复制产物" "ok"

Write-Log "WGT 热更新包已生成: $destWgt (约 $sizeMB MB)" "OK"

Write-Log "========== 全部完成 ==========" "OK"
Write-Log "BUILD-OK" "OK"
exit 0
