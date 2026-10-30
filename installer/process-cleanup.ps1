param(
    [Parameter(Mandatory=$true)][ValidateSet('Stop','Remove','Verify')][string]$Phase,
    [Parameter(Mandatory=$true)][string]$InstallDir,
    [ValidateRange(1,60)][int]$TimeoutSeconds = 15
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
$prefix = $root + '\'

function Assert-Root {
    $forbidden = @([IO.Path]::GetPathRoot($root).TrimEnd('\'), $env:USERPROFILE,
        $env:WINDIR, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA,
        $env:APPDATA, $env:PUBLIC, [Environment]::SystemDirectory,
        (Join-Path $env:WINDIR 'System32'), (Join-Path $env:LOCALAPPDATA 'Programs'),
        [IO.Path]::GetTempPath().TrimEnd('\'), (Join-Path $env:USERPROFILE 'Downloads'))
    foreach ($folder in @('DesktopDirectory','MyDocuments','MyMusic','MyPictures','MyVideos','CommonApplicationData','CommonDocuments','CommonDesktopDirectory')) {
        $forbidden += [Environment]::GetFolderPath($folder)
    }
    if (!$root -or $root -in $forbidden) { throw 'Refusing a filesystem or shared application root.' }
    $current = $root
    while ($current) {
        if ([IO.Directory]::Exists($current) -and ([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'A linked installation root requires manual cleanup.'
        }
        $current = [IO.Path]::GetDirectoryName($current)
    }
}

function Assert-Ownership {
    $manifest = Join-Path $root 'ails-update-manifest.json'
    if ([IO.File]::Exists($manifest)) {
        $value = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($value.protocol -eq 1 -and $value.executable -ceq 'AILS.exe') { return }
    }
    if ([IO.File]::Exists((Join-Path $root 'AILS.exe')) -and
        [IO.File]::Exists((Join-Path $root 'resources\backend\AILSBackend\.ails-edition'))) { return }
    # An old uninstaller may have removed every unlocked file, including the
    # ownership markers. A remaining backend can still be stopped before a
    # reinstall; this exception never authorizes recursive file removal.
    if ($Phase -eq 'Stop' -and [IO.File]::Exists((Join-Path $root 'resources\backend\AILSBackend\AILSBackend.exe'))) { return }
    throw 'The cleanup target is not a recognized AILS installation.'
}

function Get-OwnedProcesses {
    $all = @(Get-CimInstance -ClassName Win32_Process)
    $byId = @{}
    foreach ($item in $all) { $byId[[int]$item.ProcessId] = $item }
    # NSIS runs a copied uninstaller from TEMP. Its original executable and any
    # launchers in our ancestor chain must survive until uninstall completes.
    $protected = [Collections.Generic.HashSet[int]]::new()
    $ancestor = [int]$PID
    while ($byId.ContainsKey($ancestor) -and $protected.Add($ancestor)) {
        $ancestor = [int]$byId[$ancestor].ParentProcessId
    }
    $owned = [Collections.Generic.HashSet[int]]::new()
    foreach ($item in $all) {
        if ($protected.Contains([int]$item.ProcessId)) { continue }
        if ($item.ExecutablePath -and $item.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
            [void]$owned.Add([int]$item.ProcessId)
        }
    }
    do {
        $changed = $false
        foreach ($item in $all) {
            $parentId = [int]$item.ParentProcessId
            if (!$protected.Contains([int]$item.ProcessId) -and $owned.Contains($parentId) -and
                $item.CreationDate -ge $byId[$parentId].CreationDate) {
                if ($owned.Add([int]$item.ProcessId)) { $changed = $true }
            }
        }
    } while ($changed)
    return @($all | Where-Object { $owned.Contains([int]$_.ProcessId) } | Sort-Object CreationDate -Descending)
}

function Stop-OwnedProcesses {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $ownershipChecked = $false
    do {
        $running = @(Get-OwnedProcesses)
        if (!$running.Count) { return }
        if (!$ownershipChecked) { Assert-Ownership; $ownershipChecked = $true }
        foreach ($item in $running) {
            $live = $null
            try {
                $live = [Diagnostics.Process]::GetProcessById([int]$item.ProcessId)
                # Bind the process handle before killing and reject reused PIDs.
                [void]$live.Handle
                $actual = $live.StartTime.ToUniversalTime().Ticks
                $expected = $item.CreationDate.ToUniversalTime().Ticks
                if (($actual - ($actual % 10)) -ne ($expected - ($expected % 10))) { continue }
                if (!$live.HasExited) { $live.Kill() }
            } catch [ArgumentException] {
                # The process already exited.
            } catch {
                if ($null -ne $live -and !$live.HasExited) { throw }
            } finally { if ($null -ne $live) { $live.Dispose() } }
        }
        if ($timer.Elapsed.TotalSeconds -ge $TimeoutSeconds) { throw 'AILS processes did not stop; files have not been removed.' }
        Start-Sleep -Milliseconds 100
    } while ($true)
}

function Remove-OwnedTree([string]$Path) {
    if ($Path -ine $root -and !$Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup escaped the installation directory.' }
    $attributes = [IO.File]::GetAttributes($Path)
    if ($attributes -band [IO.FileAttributes]::ReparsePoint) {
        # Remove the link itself, never enumerate or modify its destination.
        if ($attributes -band [IO.FileAttributes]::Directory) { [IO.Directory]::Delete($Path, $false) }
        else { [IO.File]::Delete($Path) }
        return
    }
    if ($attributes -band [IO.FileAttributes]::Directory) {
        $entries = @([IO.Directory]::EnumerateFileSystemEntries($Path))
        if ($Path -ieq $root) {
            # Retain an ownership marker if a locked file aborts removal.
            $entries = @($entries | Sort-Object @{Expression={
                $name = [IO.Path]::GetFileName($_)
                if ($name -ieq 'ails-update-manifest.json') { 2 }
                elseif ($name -in @('AILS.exe','Uninstall AILS.exe')) { 1 }
                else { 0 }
            }})
        }
        foreach ($entry in $entries) { Remove-OwnedTree $entry }
    }
    if ($attributes -band [IO.FileAttributes]::ReadOnly) {
        [IO.File]::SetAttributes($Path, $attributes -band (-bnot [IO.FileAttributes]::ReadOnly))
    }
    if ($attributes -band [IO.FileAttributes]::Directory) { [IO.Directory]::Delete($Path, $false) }
    else { [IO.File]::Delete($Path) }
}

try {
    Assert-Root
    if ($Phase -eq 'Verify') {
        if ([IO.Directory]::Exists($root)) { throw 'AILS installation files remain; uninstall did not complete.' }
        exit 0
    }
    if (![IO.Directory]::Exists($root)) { exit 0 }
    if ($Phase -eq 'Remove') { Assert-Ownership }
    Stop-OwnedProcesses
    if ($Phase -eq 'Stop') { exit 0 }
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        try {
            Assert-Root
            if ([IO.Directory]::Exists($root)) { Remove-OwnedTree $root }
            if ([IO.Directory]::Exists($root)) { throw 'AILS installation files remain.' }
            exit 0
        } catch {
            if ($timer.Elapsed.TotalSeconds -ge $TimeoutSeconds) { throw }
            Start-Sleep -Milliseconds 200
        }
    } while ($true)
} catch { Write-Error $_.Exception.Message -ErrorAction Continue; exit 1 }
