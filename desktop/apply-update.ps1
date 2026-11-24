param(
    [Parameter(Mandatory = $true)][string]$PlanPath,
    [Parameter(Mandatory = $true)][ValidateSet('Prepare', 'Install')][string]$Mode
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.IO.Compression.FileSystem

function FullPath([string]$Value) { return [IO.Path]::GetFullPath($Value).TrimEnd('\') }
function SamePath([string]$Left, [string]$Right) { return [string]::Equals((FullPath $Left), (FullPath $Right), [StringComparison]::OrdinalIgnoreCase) }
function IsInside([string]$Child, [string]$Parent) {
    return (SamePath $Child $Parent) -or (FullPath $Child).StartsWith((FullPath $Parent) + '\', [StringComparison]::OrdinalIgnoreCase)
}
function WriteLog([string]$Text) {
    try { [IO.File]::AppendAllText($plan.log, ([DateTime]::UtcNow.ToString('o') + ' ' + $Text + "`n"), [Text.Encoding]::UTF8) } catch { }
}
function WriteResult([bool]$Ok, [string]$Message) {
    $value = @{ ok = $Ok; message = $Message; backup = $plan.backup } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($plan.result, $value, [Text.UTF8Encoding]::new($false))
}
function AssertPlainDirectory([string]$Directory) {
    $item = Get-Item -LiteralPath $Directory -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Directory is not a plain folder: $Directory" }
}
function RemoveStage {
    if (Test-Path -LiteralPath $plan.stage) {
        AssertPlainDirectory $plan.stage
        # Only this plan's exact sibling staging directory can be removed.
        if (-not (SamePath $plan.stage $expectedStage)) { throw 'Unsafe staging path' }
        Remove-Item -LiteralPath $plan.stage -Recurse -Force
    }
}

$plan = Get-Content -LiteralPath $PlanPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($plan.id -cnotmatch '^[a-f0-9]{32}$' -or $plan.version -cnotmatch '^\d+\.\d+\.\d+$' -or $plan.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid update plan' }
$work = Split-Path -Parent (FullPath $PlanPath)
$updates = Split-Path -Parent $work
$userData = Split-Path -Parent $updates
if (-not (SamePath $work (Join-Path $updates $plan.id)) -or (Split-Path -Leaf $updates) -cne 'updates') { throw 'Invalid update work directory' }
$target = FullPath $plan.target
$parent = Split-Path -Parent $target
$name = Split-Path -Leaf $target
if (-not $parent -or (SamePath $target ([IO.Path]::GetPathRoot($target))) -or (IsInside $userData $target) -or (IsInside $target $userData)) { throw 'Installation and data paths must be separate' }
$expectedStage = Join-Path $parent ('.' + $name + '.packtool-update-' + $plan.id)
$expectedBackup = Join-Path $parent ('.' + $name + '.packtool-backup-' + $plan.id)
if (-not (SamePath $plan.stage $expectedStage) -or -not (SamePath $plan.backup $expectedBackup) -or
    -not (SamePath $plan.zip (Join-Path $work 'update.zip')) -or
    -not (SamePath $plan.ready (Join-Path $work 'ready')) -or
    -not (SamePath $plan.armed (Join-Path $work 'armed')) -or
    -not (SamePath $plan.result (Join-Path $updates 'last-result.json')) -or
    -not (SamePath $plan.log (Join-Path $userData 'logs\update.log')) -or $plan.executable -cne 'PackTool.exe') { throw 'Unsafe update paths' }
AssertPlainDirectory $parent
AssertPlainDirectory $target
AssertPlainDirectory $work
$zipStream = [IO.File]::OpenRead($plan.zip)
$sha = [Security.Cryptography.SHA256]::Create()
try { $actualHash = [BitConverter]::ToString($sha.ComputeHash($zipStream)).Replace('-', '').ToLowerInvariant() }
finally { $zipStream.Dispose(); $sha.Dispose() }
if ($actualHash -cne $plan.sha256) { throw 'Update archive checksum mismatch' }

if ($Mode -eq 'Prepare') {
    try {
        if ((Test-Path -LiteralPath $plan.stage) -or (Test-Path -LiteralPath $plan.backup)) { throw 'Update destination already exists' }
        [void][IO.Directory]::CreateDirectory($plan.stage)
        $archive = [IO.Compression.ZipFile]::OpenRead($plan.zip)
        try {
            if ($archive.Entries.Count -gt 20000) { throw 'Too many archive entries' }
            $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
            [long]$total = 0
            foreach ($entry in $archive.Entries) {
                $relative = $entry.FullName
                # Reject traversal, Windows aliases/ADS/reserved names, symlinks and duplicate files.
                if ($relative.Contains('\') -or -not $relative.StartsWith('PackTool-win32-x64/', [StringComparison]::Ordinal)) { throw "Invalid archive root: $relative" }
                $relative = $relative.Substring('PackTool-win32-x64/'.Length)
                if (-not $relative) { continue }
                foreach ($part in $relative.TrimEnd('/').Split('/')) {
                    if (-not $part -or $part -match '[<>:"|?*\x00-\x1f]' -or $part -match '[. ]$' -or $part -in @('.', '..') -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw "Unsafe archive path: $relative" }
                }
                if ((($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000 -or ($entry.ExternalAttributes -band 0x400)) { throw 'Archive links are not allowed' }
                if (-not $seen.Add($relative.TrimEnd('/'))) { throw 'Duplicate archive path' }
                $destination = FullPath (Join-Path $plan.stage $relative.Replace('/', '\'))
                if (-not (IsInside $destination $plan.stage)) { throw 'Archive escapes staging directory' }
                $total += $entry.Length
                if ($total -gt 3GB) { throw 'Expanded update is too large' }
                if ($relative.EndsWith('/')) { [void][IO.Directory]::CreateDirectory($destination); continue }
                [void][IO.Directory]::CreateDirectory((Split-Path -Parent $destination))
                $inputStream = $entry.Open()
                $outputStream = [IO.File]::Open($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
                try {
                    $buffer = [byte[]]::new(1048576)
                    [long]$written = 0
                    while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                        $written += $count
                        if ($written -gt $entry.Length) { throw 'Archive entry exceeds its declared size' }
                        $outputStream.Write($buffer, 0, $count)
                    }
                    if ($written -ne $entry.Length) { throw 'Incomplete archive entry' }
                } finally { $outputStream.Dispose(); $inputStream.Dispose() }
            }
        } finally { $archive.Dispose() }
        foreach ($required in @('PackTool.exe', 'resources\app.asar', 'resources\backend\pack-tool-backend.exe', 'packtool-release.json')) {
            if (-not [IO.File]::Exists((Join-Path $plan.stage $required))) { throw "Update is missing $required" }
        }
        $manifest = Get-Content -LiteralPath (Join-Path $plan.stage 'packtool-release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($manifest.version -cne $plan.version -or $manifest.platform -cne 'win32' -or $manifest.arch -cne 'x64') { throw 'Update manifest does not match this release' }
        WriteLog ('update.prepared version=' + $plan.version)
    } catch {
        WriteLog ('update.prepare_failed ' + $_.Exception.Message)
        RemoveStage
        throw
    }
    exit 0
}

$movedOld = $false
$movedNew = $false
$newProcess = $null
try {
    AssertPlainDirectory $plan.stage
    if (Test-Path -LiteralPath $plan.backup) { throw 'Backup destination already exists' }
    if (Test-Path -LiteralPath $plan.ready) { throw 'Readiness marker already exists' }
    $pending = Join-Path $updates 'pending.json'
    if (Test-Path -LiteralPath $pending) { Remove-Item -LiteralPath $pending -Force }
    [IO.File]::WriteAllText($plan.armed, 'ready')
    WriteLog ('update.waiting pid=' + $plan.oldPid)
    $oldProcess = Get-Process -Id $plan.oldPid -ErrorAction SilentlyContinue
    if ($oldProcess -and -not $oldProcess.WaitForExit(60000)) { throw 'PackTool did not exit; installation was left unchanged' }
    # Both directories are siblings on the installation volume, including apps on D:.
    [IO.Directory]::Move($target, $plan.backup)
    $movedOld = $true
    [IO.Directory]::Move($plan.stage, $target)
    $movedNew = $true
    $newProcess = Start-Process -FilePath (Join-Path $target $plan.executable) -ArgumentList ('--update-id=' + $plan.id) -WorkingDirectory $target -WindowStyle Hidden -PassThru
    $deadline = [DateTime]::UtcNow.AddMinutes(16)
    while (-not (Test-Path -LiteralPath $plan.ready)) {
        Start-Sleep -Milliseconds 500
        if ($newProcess.HasExited) { throw 'The new version exited before startup completed' }
        if ([DateTime]::UtcNow -gt $deadline) { throw 'The new version did not report successful startup' }
    }
    if ([IO.File]::ReadAllText($plan.ready) -cne $plan.version) { throw 'The started version does not match the update' }
    WriteResult $true ('Updated to ' + $plan.version)
    WriteLog ('update.succeeded version=' + $plan.version + ' old_program=' + $plan.backup)
    # Retain the old program, including any files the user manually put beside it.
    Remove-Item -LiteralPath $plan.zip -Force
} catch {
    $reason = $_.Exception.Message
    WriteLog ('update.install_failed ' + $reason)
    if ($newProcess -and -not $newProcess.HasExited) {
        & "$env:SystemRoot\System32\taskkill.exe" /PID $newProcess.Id /T /F 2>$null | Out-Null
        [void]$newProcess.WaitForExit(10000)
    }
    try {
        if ($movedNew) { [IO.Directory]::Move($target, $plan.stage) }
        if ($movedOld) {
            [IO.Directory]::Move($plan.backup, $target)
        }
        $stillRunning = Get-Process -Id $plan.oldPid -ErrorAction SilentlyContinue
        if (-not $stillRunning) { Start-Process -FilePath (Join-Path $target $plan.executable) -WorkingDirectory $target -WindowStyle Hidden }
        WriteResult $false ('Update failed; the previous program was preserved. ' + $reason)
    } catch { WriteLog ('update.rollback_failed ' + $_.Exception.Message); WriteResult $false ('Recovery required. Previous program: ' + $plan.backup + '. ' + $reason) }
    exit 1
}
