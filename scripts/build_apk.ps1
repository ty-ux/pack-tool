# ============================================================
#  App 一键打包脚本 (通用)
#  依赖: HBuilderX CLI + Android SDK + JDK + Gradle(通过wrapper)
#  用法: powershell -ExecutionPolicy Bypass -File build_apk.ps1 -Config "D:\path\to\config.json"
# ============================================================
param(
    [string]$Config = "",
    [string]$BuildType = "debug"   # debug / release
)

$ErrorActionPreference = "Stop"

# 让 Write-Host 输出 UTF-8 字节流（中文 Windows 默认 GBK，会导致 build.log 乱码）
# 必须放在任何输出之前；服务器端按 UTF-8 读取 build.log
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

# 写文件且不带 BOM（Gradle/Groovy 和 Android 构建不接受 BOM）
function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

# 校验文件头是否为真正的 PNG（扩展名可能是 jpg/webp 改的，直接交给 aapt 会编译失败）
function Test-PngFile {
    param([string]$Path)
    try {
        $fs = [System.IO.File]::OpenRead($Path)
        try {
            $buf = New-Object byte[] 8
            $n = $fs.Read($buf, 0, 8)
            return ($n -eq 8 -and $buf[0] -eq 0x89 -and $buf[1] -eq 0x50 -and
                $buf[2] -eq 0x4E -and $buf[3] -eq 0x47 -and $buf[4] -eq 0x0D -and
                $buf[5] -eq 0x0A -and $buf[6] -eq 0x1A -and $buf[7] -eq 0x0A)
        } finally {
            $fs.Close()
        }
    } catch {
        return $false
    }
}

# 自定义图标：支持单个图片文件，或包含 drawable*/icon.png 的目录（按 dpi 分别使用）
# 覆盖前把原图标备份到 simpleDemo\.pack-tool\icon-backup\<density>\icon.png，重复构建不会覆盖备份
function Apply-AppIcon {
    param(
        [string]$IconPath,
        [string]$SrcMain,
        [string]$BackupRoot
    )

    $resDir = Join-Path $SrcMain "res"
    if (-not (Test-Path $resDir)) {
        Write-Log "找不到 res 目录，跳过自定义图标: $resDir" "WARN"
        return
    }

    $targets = @(
        Get-ChildItem -Path $resDir -Directory -Filter "drawable*" |
            Where-Object { Test-Path (Join-Path $_.FullName "icon.png") } |
            Sort-Object Name |
            ForEach-Object { Join-Path $_.FullName "icon.png" }
    )
    if ($targets.Count -eq 0) {
        # 工程里没有现成图标时补一个基础 drawable/icon.png，保证 @drawable/icon 可解析
        $baseDir = Join-Path $resDir "drawable"
        New-Item -ItemType Directory -Force -Path $baseDir | Out-Null
        $targets = @(Join-Path $baseDir "icon.png")
        Write-Log "工程内未找到 icon.png，将创建: $($targets[0])" "WARN"
    }

    # 目录模式：收集各 dpi 的源图标；文件模式：所有密度共用同一个源
    $folderMode = Test-Path $IconPath -PathType Container
    $sources = @{}
    if ($folderMode) {
        $direct = Join-Path $IconPath "icon.png"
        if (Test-Path $direct) { $sources[""] = $direct }
        foreach ($dir in Get-ChildItem -Path $IconPath -Directory -Filter "drawable*") {
            $p = Join-Path $dir.FullName "icon.png"
            if (Test-Path $p) { $sources[$dir.Name] = $p }
        }
        if ($sources.Count -eq 0) {
            Write-Log "图标目录中没有 icon.png 或 drawable*\icon.png: $IconPath" "WARN"
            return
        }
        Write-Log "自定义图标目录: $IconPath（$($sources.Count) 个源文件）"
    }

    $priority = @("drawable-xxhdpi", "drawable-xhdpi", "drawable-hdpi", "drawable-mdpi", "drawable-ldpi", "drawable")
    $converted = @{}
    $tempFiles = New-Object System.Collections.ArrayList
    $backedUp = 0
    $applied = 0
    try {
        foreach ($dst in $targets) {
            $density = Split-Path (Split-Path $dst -Parent) -Leaf
            $sourceFile = $IconPath
            if ($folderMode) {
                $sourceFile = $null
                if ($sources.ContainsKey($density)) { $sourceFile = $sources[$density] }
                elseif ($sources.ContainsKey("")) { $sourceFile = $sources[""] }
                else {
                    foreach ($candidate in $priority) {
                        if ($sources.ContainsKey($candidate)) { $sourceFile = $sources[$candidate]; break }
                    }
                }
                if (-not $sourceFile) {
                    Write-Log "图标目录缺少 $density 的源图标，保留工程原图标" "WARN"
                    continue
                }
            }

            if (-not $converted.ContainsKey($sourceFile)) {
                $png = $sourceFile
                if (-not (Test-PngFile $png)) {
                    try {
                        Add-Type -AssemblyName System.Drawing
                        $img = [System.Drawing.Image]::FromFile($png)
                        try {
                            $tmp = Join-Path $env:TEMP ("packtool-icon-{0}.png" -f [guid]::NewGuid())
                            $img.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
                        } finally {
                            $img.Dispose()
                        }
                        [void]$tempFiles.Add($tmp)
                        $png = $tmp
                        Write-Log "图标已转换为 PNG: $sourceFile"
                    } catch {
                        Write-Log "图标无法转换为 PNG，跳过 ${density}: $sourceFile ($_)" "WARN"
                        $png = ""
                    }
                }
                $converted[$sourceFile] = $png
            }
            $png = $converted[$sourceFile]
            if (-not $png) { continue }

            try {
                if (Test-Path $dst) {
                    $backup = Join-Path (Join-Path $BackupRoot $density) "icon.png"
                    if (-not (Test-Path $backup)) {
                        New-Item -ItemType Directory -Force -Path (Split-Path $backup -Parent) | Out-Null
                        Copy-Item $dst $backup -Force
                        $backedUp++
                    }
                }
                $dir = Split-Path $dst -Parent
                if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
                Copy-Item $png $dst -Force
                $applied++
            } catch {
                Write-Log "写入图标失败: $dst ($_)" "WARN"
            }
        }
    } finally {
        foreach ($tmp in $tempFiles) {
            if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
        }
    }

    if ($applied -gt 0) {
        if ($backedUp -gt 0) {
            Write-Log "已备份原图标 $backedUp 个 → $BackupRoot"
        }
        $label = if ($folderMode) { "自定义图标目录" } else { "自定义图标" }
        Write-Log "$label 已写入 $applied 个 drawable 目录: $IconPath" "OK"
    } else {
        Write-Log "自定义图标未能写入任何 drawable 目录: $IconPath" "WARN"
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

# 流水线步骤事件（供前端 Steps 展示解析）
# 格式: [STEP] <序号>|<key>|<名称>|<running|ok|fail>
function Write-Step {
    param([int]$Index, [string]$Key, [string]$Name, [string]$State)
    $time = Get-Date -Format "HH:mm:ss"
    Write-Host "[$time] [STEP] $Index|$Key|$Name|$State"
}

try {
    $cfg = Get-Content $Config -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    Write-Log "配置文件解析失败: $_" "ERR"
    exit 1
}

Write-Log "已加载配置: $Config"
Write-Log "App名称: $($cfg.app.name) | 包名: $($cfg.android.packageName) | 版本: $($cfg.app.versionName) ($($cfg.app.versionCode))"

# ---------- 路径解析 ----------
$hbxCli   = $cfg.paths.hbuilderxCli
$project  = $cfg.paths.projectDir          # uniapp 项目根
$integrateDir = $cfg.paths.integrateDir    # HBuilder-Integrate-AS 根
$appId = ([string]$cfg.app.appid).Trim()
if ($appId -notmatch '^[A-Za-z0-9_-]+$') {
    Write-Log "请填写 manifest.json 中的 AppID（字母、数字、下划线或连字符）" "ERR"
    exit 1
}
if (-not $integrateDir) {
    Write-Log "未配置离线打包工程目录" "ERR"
    exit 1
}
$simpleDemo = Join-Path $integrateDir "simpleDemo"
$srcMain  = Join-Path $simpleDemo "src\main"
$manifestXml = Join-Path $srcMain "AndroidManifest.xml"
$gradleDir = $integrateDir

$mustExist = @(
    @{p=$hbxCli; d="HBuilderX CLI"},
    @{p=$project; d="uniapp 项目目录"},
    @{p=$integrateDir; d="离线打包工程目录"},
    @{p=$manifestXml; d="AndroidManifest.xml"}
)
foreach ($m in $mustExist) {
    if (-not $m.p -or -not (Test-Path -LiteralPath $m.p)) {
        Write-Log "路径不存在: $($m.d) -> $($m.p)" "ERR"
        exit 1
    }
}

# 可选: 自定义图标（步骤3 写入 res\drawable*\icon.png）
$iconPath = ""
$iconConfigured = [string]$cfg.app.icon
if ($iconConfigured) {
    if (Test-Path $iconConfigured) {
        $iconPath = $iconConfigured
        $kind = if (Test-Path $iconConfigured -PathType Container) { "目录" } else { "文件" }
        Write-Log "自定义图标${kind}: $iconPath"
    } else {
        Write-Log "自定义图标路径不存在，本次沿用工程现有图标: $iconConfigured" "WARN"
    }
}

# ---------- 0. 同步版本号到项目 manifest.json ----------
# 与 build_wgt.ps1 保持一致：HBuilderX 编译 appResource 读的是项目 manifest.json 的
# versionName/versionCode。若不同步，APK 内嵌的 uni 资源会沿用上次 wgt 的旧版本号，
# 导致 plus.runtime.getProperty 返回错误版本（热更判断、版本显示都会错乱）
Write-Log "步骤0/5: 同步版本到项目 manifest.json..." "STEP"
$manifestPath = Join-Path $project "manifest.json"
try {
    $manifestRaw = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $manifestRaw.versionName = [string]$cfg.app.versionName
    $manifestRaw.versionCode = [int]$cfg.app.versionCode
    $manifestJson = $manifestRaw | ConvertTo-Json -Depth 20
    Write-Utf8NoBom $manifestPath $manifestJson
    Write-Log "manifest 版本已同步: v$($cfg.app.versionName)($($cfg.app.versionCode))" "OK"
    Write-Step 0 "version-sync" "同步版本号" "ok"
} catch {
    Write-Log "同步 manifest 版本失败: $_" "ERR"
    Write-Step 0 "version-sync" "同步版本号" "fail"
    exit 1
}

# ---------- 1. HBuilderX 编译前端资源 ----------
Write-Log "步骤1/5: HBuilderX 编译前端资源 (appResource)..." "STEP"
Write-Step 1 "compile" "前端资源编译" "running"
$compileLog = Join-Path $PSScriptRoot "..\logs\compile.log"
New-Item -ItemType Directory -Force -Path (Split-Path $compileLog) | Out-Null

# 记录编译开始时间，用于校验产物是否为本次编译新生成
$compileStart = Get-Date

# CLI 输出逐行实时转发到 build.log（前端面板可见）；同时汇总落盘 compile.log
# 注意: PS 5.1 下 stderr 重定向 + EAP=Stop 会抛 NativeCommandError，必须临时放为 Continue
Write-Log "--- HBuilderX CLI 输出（实时） ---" "STEP"
$oldEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$compileLines = New-Object System.Collections.Generic.List[string]
try {
    & $hbxCli publish app-android --type appResource --project $project 2>&1 | ForEach-Object {
        $t = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { $_.ToString() }
        $compileLines.Add($t)
        Write-Host $t
    }
} finally {
    $ErrorActionPreference = $oldEAP
}
$compileOut = $compileLines -join "`r`n"
$compileOut | Set-Content $compileLog -Encoding UTF8

# HBuilderX CLI 的退出码不可靠（如"未检测到已打开的HBuilderX"这类错误也可能返回 0），
# 因此成功必须以"本次新生成的、内容完整的 www"为准，绝不能信任遗留的旧/空产物。
# 入口文件兼容新旧 HBuilderX：旧版产物为 index.html，5.24+ 为 __uniappview.html
function Test-FreshWww {
    param([string]$Path, [datetime]$Since)
    if (-not [string]::IsNullOrEmpty($Path) -and (Test-Path $Path)) {
        $entrance = $null
        foreach ($name in @('index.html', '__uniappview.html')) {
            $f = Get-Item (Join-Path $Path $name) -ErrorAction SilentlyContinue
            if ($f) { $entrance = $f; break }
        }
        if ($entrance -and ($entrance.LastWriteTime -ge $Since) -and (Test-Path (Join-Path $Path 'manifest.json'))) {
            return $true
        }
    }
    return $false
}

$resWww = Join-Path $project "unpackage\resources\$appId\www"
$compileOk = ($LASTEXITCODE -eq 0) -and (Test-FreshWww $resWww $compileStart)

if ($compileOk) {
    Write-Log "前端资源编译成功" "OK"
    Write-Step 1 "compile" "前端资源编译" "ok"
} else {
    Write-Log "前端资源编译失败（原因见日志: $compileLog）" "ERR"
    Write-Log "请确认 AppID 与项目 manifest.json 一致，且本次构建生成了 $resWww" "WARN"
    Write-Host $compileOut -ForegroundColor Red
    Write-Step 1 "compile" "前端资源编译" "fail"
    if ($compileOut -match "未检测到已打开的HBuilderX") {
        Write-Log "提示: 请先启动 HBuilderX（或用 cli open 打开项目）后再打包" "WARN"
    }
    exit 1
}

# 定位编译产物 www
if (-not $resWww -or -not (Test-Path $resWww)) {
    Write-Log "找不到编译产物 www 目录" "ERR"
    exit 1
}
Write-Log "编译产物: $resWww"

# ---------- 2. 同步 www 到离线工程 ----------
Write-Log "步骤2/5: 同步前端资源到离线工程..." "STEP"
Write-Step 2 "sync" "同步前端资源" "running"
$dstWww = Join-Path $srcMain "assets\apps\$appId\www"
New-Item -ItemType Directory -Force -Path (Split-Path $dstWww) | Out-Null
if (Test-Path $dstWww) {
    Remove-Item $dstWww -Recurse -Force
}
Copy-Item $resWww $dstWww -Recurse -Force
Write-Log "资源已同步: $dstWww" "OK"
Write-Step 2 "sync" "同步前端资源" "ok"

# ---------- 3. 修改 AndroidManifest.xml ----------
Write-Log "步骤3/5: 更新 AndroidManifest.xml (权限/名称/版本)..." "STEP"
Write-Step 3 "manifest" "更新 App 配置" "running"
$manifestContent = Get-Content $manifestXml -Raw -Encoding UTF8

# 防御：读取失败则中止，绝不覆盖原文件
if ([string]::IsNullOrEmpty($manifestContent)) {
    Write-Log "读取 AndroidManifest.xml 失败（文件为空），中止打包以避免破坏文件" "ERR"
    Write-Step 3 "manifest" "更新 App 配置" "fail"
    exit 1
}
if ($manifestContent -notmatch "<manifest") {
    Write-Log "AndroidManifest.xml 内容异常（不含 <manifest），中止打包" "ERR"
    Write-Step 3 "manifest" "更新 App 配置" "fail"
    exit 1
}
Write-Log "AndroidManifest.xml 读取成功 ($($manifestContent.Length) 字符)" "INFO"

# 3.1 名称
$appName = $cfg.app.name
$stringsXml = Join-Path $srcMain "res\values\strings.xml"
if (Test-Path $stringsXml) {
    $strings = Get-Content $stringsXml -Raw -Encoding UTF8
    if (-not [string]::IsNullOrEmpty($strings) -and $strings -match '<resources') {
        $strings = $strings -replace '(?s)(<string name="app_name">).*?(</string>)', "`${1}$appName`${2}"
        Write-Utf8NoBom $stringsXml $strings
        Write-Log "App名称已更新: $appName" "OK"
    } else {
        Write-Log "strings.xml 读取异常，跳过名称修改" "WARN"
    }
}

# 3.2 版本号 (写入 gradle)
$appGradle = Join-Path $simpleDemo "build.gradle"
if (Test-Path $appGradle) {
    $gradle = Get-Content $appGradle -Raw -Encoding UTF8
    if (-not [string]::IsNullOrEmpty($gradle) -and $gradle -match 'apply plugin') {
        $gradle = $gradle -replace 'versionCode \d+', "versionCode $($cfg.app.versionCode)"
        $gradle = $gradle -replace 'versionName "\d+(\.\d+)*"', "versionName `"$($cfg.app.versionName)`""
        $gradle = $gradle -replace 'applicationId "[^"]*"', "applicationId `"$($cfg.android.packageName)`""
        $gradle = $gradle -replace 'namespace "[^"]*"', "namespace `"$($cfg.android.packageName)`""
        Write-Utf8NoBom $appGradle $gradle
        Write-Log "版本/包名已更新: v$($cfg.app.versionName)($($cfg.app.versionCode)) / $($cfg.android.packageName)" "OK"
    } else {
        Write-Log "build.gradle 读取异常，跳过版本修改" "WARN"
    }
}

# 3.3 权限
$permissionMap = @{
    "INTERNET"              = "android.permission.INTERNET"
    "ACCESS_NETWORK_STATE"  = "android.permission.ACCESS_NETWORK_STATE"
    "CHANGE_NETWORK_STATE"  = "android.permission.CHANGE_NETWORK_STATE"
    "ACCESS_WIFI_STATE"     = "android.permission.ACCESS_WIFI_STATE"
    "CHANGE_WIFI_STATE"     = "android.permission.CHANGE_WIFI_STATE"
    "CAMERA"                = "android.permission.CAMERA"
    "FLASHLIGHT"            = "android.permission.FLASHLIGHT"
    "WRITE_EXTERNAL_STORAGE"= "android.permission.WRITE_EXTERNAL_STORAGE"
    "READ_EXTERNAL_STORAGE" = "android.permission.READ_EXTERNAL_STORAGE"
    "READ_MEDIA_IMAGES"     = "android.permission.READ_MEDIA_IMAGES"
    "REQUEST_INSTALL_PACKAGES" = "android.permission.REQUEST_INSTALL_PACKAGES"
    "VIBRATE"               = "android.permission.VIBRATE"
    "WAKE_LOCK"             = "android.permission.WAKE_LOCK"
    "READ_PHONE_STATE"      = "android.permission.READ_PHONE_STATE"
    "GET_ACCOUNTS"          = "android.permission.GET_ACCOUNTS"
    "READ_LOGS"             = "android.permission.READ_LOGS"
    "WRITE_SETTINGS"        = "android.permission.WRITE_SETTINGS"
}

# 从配置中获取启用的权限列表
$enabledPerms = @()
if ($cfg.android.permissions) {
    foreach ($perm in $cfg.android.permissions) {
        $enabledPerms += $perm
    }
}

# 重建 manifest 的权限段
$permBlock = ""
foreach ($p in $enabledPerms) {
    if ($permissionMap.ContainsKey($p)) {
        $permBlock += "    <uses-permission android:name=`"$($permissionMap[$p])`"/>`n"
    } else {
        # 支持直接写完整权限名
        $permBlock += "    <uses-permission android:name=`"$p`"/>`n"
    }
}
# 相机硬件特性
if ($enabledPerms -contains "CAMERA") {
    $permBlock += "    <uses-feature android:name=`"android.hardware.camera`" android:required=`"false`"/>`n"
    $permBlock += "    <uses-feature android:name=`"android.hardware.camera.autofocus`" android:required=`"false`"/>`n"
}

# 替换 manifest 中的权限段（在 <application> 之前）
$permStartMarker = "<!-- ================= 应用权限 ================= -->"
if ($manifestContent.Contains($permStartMarker)) {
    # 找到权限段起始和 application 起始，替换整段
    $appIdx = $manifestContent.IndexOf("<application")
    $permIdx = $manifestContent.IndexOf($permStartMarker)
    if ($appIdx -gt $permIdx -and $permIdx -ge 0) {
        $newManifest = $manifestContent.Substring(0, $permIdx) + $permStartMarker + "`n" + $permBlock + "`n" + $manifestContent.Substring($appIdx)
        $manifestContent = $newManifest
    }
} else {
    # 没有权限标记，在 <application> 前插入
    $appIdx = $manifestContent.IndexOf("<application")
    if ($appIdx -ge 0) {
        $newManifest = $manifestContent.Substring(0, $appIdx) + "    <!-- ================= 应用权限 ================= -->`n" + $permBlock + "`n" + $manifestContent.Substring($appIdx)
        $manifestContent = $newManifest
    }
}

# 防御：替换后若为空则中止
if ([string]::IsNullOrEmpty($manifestContent)) {
    Write-Log "权限替换后 manifest 为空，中止打包" "ERR"
    Write-Step 3 "manifest" "更新 App 配置" "fail"
    exit 1
}

# 包名（manifest 中 package 属性）
$manifestContent = $manifestContent -replace 'package="[^"]*"', "package=`"$($cfg.android.packageName)`""

Write-Utf8NoBom $manifestXml $manifestContent
Write-Log "AndroidManifest.xml 已更新 ($($enabledPerms.Count) 个权限)" "OK"

# 3.4 自定义图标：覆盖 res\drawable*\icon.png，原图标先备份
if ($iconPath) {
    $iconBackupRoot = Join-Path $simpleDemo ".pack-tool\icon-backup"
    Apply-AppIcon -IconPath $iconPath -SrcMain $srcMain -BackupRoot $iconBackupRoot
}

Write-Step 3 "manifest" "更新 App 配置" "ok"

# ---------- 4. Gradle 打包 ----------
Write-Log "步骤4/5: Gradle 打包 APK ($BuildType)..." "STEP"
Write-Step 4 "gradle" "Gradle 打包" "running"
$configuredJava = ([string]$cfg.paths.javaHome).Trim()
if ($configuredJava) {
    $env:JAVA_HOME = $configuredJava
}

$gradleWrapper = Join-Path $gradleDir "gradlew.bat"
if (-not (Test-Path $gradleWrapper)) {
    Write-Log "找不到 gradlew.bat: $gradleWrapper" "ERR"
    exit 1
}

# 校验 buildType
$buildType = $BuildType.ToLower()
if ($buildType -notin @("debug", "release")) {
    Write-Log "无效的构建类型: $BuildType (可选 debug/release)" "ERR"
    exit 1
}

$gradleLog = Join-Path $PSScriptRoot "..\logs\gradle.log"

# 必须在 HBuilder-Integrate-AS 根目录下运行 gradlew
# 注意: gradlew 大量输出到 stderr，需临时放开 ErrorActionPreference 避免 NativeCommandError 中断
# --rerun-tasks: 强制重新执行所有任务（避免增量构建 UP-TO-DATE 导致复制出旧 APK）
$oldEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$gradleLines = New-Object System.Collections.Generic.List[string]
Write-Log "--- Gradle 输出（实时） ---" "STEP"
Push-Location $gradleDir
try {
    $gradleTask = ":simpleDemo:assemble$($buildType.Substring(0,1).ToUpper())$($buildType.Substring(1))"
    # cmd 内部的 2>&1 在 cmd 层合并 stderr，PowerShell 只见纯文本行，逐行实时转发
    & cmd.exe /c "`"$gradleWrapper`" $gradleTask --rerun-tasks --no-daemon 2>&1" | ForEach-Object {
        $gradleLines.Add($_.ToString())
        Write-Host $_.ToString()
    }
    $gradleExitCode = $LASTEXITCODE
} finally {
    Pop-Location
    $ErrorActionPreference = $oldEAP
}
$gradleOut = $gradleLines -join "`r`n"
$gradleOut | Set-Content $gradleLog -Encoding UTF8

if ($gradleExitCode -eq 0 -and $gradleOut -match "BUILD SUCCESSFUL") {
    Write-Log "Gradle 打包成功" "OK"
    Write-Step 4 "gradle" "Gradle 打包" "ok"
} else {
    Write-Log "Gradle 打包失败，日志: $gradleLog" "ERR"
    Write-Host $gradleOut -ForegroundColor Red
    Write-Step 4 "gradle" "Gradle 打包" "fail"
    exit 1
}

# APK 产物
$apkPath = Join-Path $simpleDemo "build\outputs\apk\$buildType\simpleDemo-$buildType.apk"
if (-not (Test-Path $apkPath)) {
    Write-Log "APK 产物不存在: $apkPath" "ERR"
    Write-Step 4 "gradle" "Gradle 打包" "fail"
    exit 1
}

# 输出到指定路径
$outputDir = $cfg.paths.outputDir
if ($outputDir) {
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
    $outName = "$($cfg.app.name)-v$($cfg.app.versionName)-$buildType.apk"
    $outName = $outName -replace '[\\/:*?"<>|]', '_'
    $destApk = Join-Path $outputDir $outName
    Copy-Item $apkPath $destApk -Force
    Write-Log "APK 已复制到: $destApk" "OK"
    $apkPath = $destApk
}

Write-Log "APK 生成完毕: $apkPath" "OK"

# ---------- 可选: 安装到设备 ----------
if ($cfg.install.enabled -and $cfg.install.serial) {
    Write-Log "检测到安装配置，尝试安装到设备: $($cfg.install.serial)" "STEP"
    Write-Step 5 "install" "安装到设备" "running"
    $adb = $cfg.paths.adb
    if (-not $adb -or -not (Test-Path -LiteralPath $adb -PathType Leaf)) {
        $adb = (Get-Command adb.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    }
    if ($adb) {
        $oldEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            & $adb -s $cfg.install.serial install -r $apkPath 2>&1 | ForEach-Object {
                $t = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { $_.ToString() }
                Write-Host $t
            }
            $installOk = ($LASTEXITCODE -eq 0)
        } finally {
            $ErrorActionPreference = $oldEAP
        }
        if ($installOk) {
            Write-Log "已安装到设备 $($cfg.install.serial)" "OK"
            Write-Step 5 "install" "安装到设备" "ok"
            # 可选启动
            if ($cfg.install.launch -and $cfg.android.packageName) {
                & $adb -s $cfg.install.serial shell am start -n "$($cfg.android.packageName)/io.dcloud.PandoraEntry" 2>&1 | Out-Null
                Write-Log "已启动 App" "OK"
            }
        } else {
            Write-Log "安装失败" "WARN"
            Write-Step 5 "install" "安装到设备" "fail"
        }
    } else {
        Write-Log "找不到 adb: $adb" "WARN"
        Write-Step 5 "install" "安装到设备" "fail"
    }
} else {
    Write-Log "未启用自动安装 (可在配置中开启)" "INFO"
}

Write-Log "========== 全部完成 ==========" "OK"
Write-Log "BUILD-OK" "OK"
exit 0
