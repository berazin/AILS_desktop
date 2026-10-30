param(
    [Parameter(Mandatory = $true)][ValidateSet('Initialize', 'Tools', 'Finish')][string]$Phase,
    [Parameter(Mandatory = $true)][string]$SessionDir,
    [Parameter(Mandatory = $true)][string]$SessionId,
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [Parameter(Mandatory = $true)][string]$ExecutableName,
    [Parameter(Mandatory = $true)][string]$Version,
    [switch]$RequireFfmpeg,
    [string]$UserStateScript
)

$ErrorActionPreference = 'Stop'
if (!$UserStateScript) { $UserStateScript = Join-Path $PSScriptRoot 'user-state.ps1' }
# This helper always runs in Windows PowerShell, including when the parent app
# inherited a PowerShell 7 module path from a development terminal.
$env:PSModulePath = Join-Path $PSHOME 'Modules'
$request = $null
$stageDir = $null
$backupDir = $null
$movedOld = $false
$switched = $false
$handoffAccepted = $false

function Write-Status([string]$State, [string]$Message = '', [hashtable]$Details = @{}) {
    if (!('AilsUpdateStatusFile' -as [type])) {
        # File.Replace briefly opens the destination exclusively on Windows.
        # Old apps treat even one sharing violation while polling as a failed
        # update. Rename the complete temporary file instead: existing readers
        # keep their handle and new readers see either complete JSON version.
        # NSIS also has a native System.dll in its working directory. Resolve
        # the framework assembly explicitly so the compiler cannot pick it up.
        Add-Type -ReferencedAssemblies ([Uri].Assembly.Location) -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class AilsUpdateStatusFile {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool MoveFileEx(string source, string target, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share,
        IntPtr security, uint creation, uint attributes, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetFileInformationByHandle(SafeFileHandle file,
        int informationClass, IntPtr information, uint size);
    private static int RenameWithOpenReaders(string source, string target) {
        // DELETE access; share read/write/delete; open the completed temp file.
        using (SafeFileHandle file = CreateFile(source, 0x10000, 7, IntPtr.Zero, 3, 0x80, IntPtr.Zero)) {
            if (file.IsInvalid) return Marshal.GetLastWin32Error();
            byte[] name = Encoding.Unicode.GetBytes(target);
            // FILE_RENAME_INFO layout differs in 32-bit NSIS PowerShell and x64.
            int rootOffset = IntPtr.Size == 8 ? 8 : 4;
            int lengthOffset = rootOffset + IntPtr.Size;
            int nameOffset = lengthOffset + 4;
            int size = nameOffset + name.Length + 2;
            IntPtr data = Marshal.AllocHGlobal(size);
            try {
                Marshal.Copy(new byte[size], 0, data, size);
                // REPLACE_IF_EXISTS | POSIX_SEMANTICS keeps old reader handles
                // valid while subsequent opens receive the complete new file.
                Marshal.WriteInt32(data, 0, 3);
                Marshal.WriteInt32(data, lengthOffset, name.Length);
                Marshal.Copy(name, 0, IntPtr.Add(data, nameOffset), name.Length);
                return SetFileInformationByHandle(file, 22, data, (uint)size)
                    ? 0 : Marshal.GetLastWin32Error(); // FileRenameInfoEx
            } finally { Marshal.FreeHGlobal(data); }
        }
    }
    public static int Publish(string source, string target) {
        int error = RenameWithOpenReaders(source, target);
        // Older Windows/filesystems may not implement FileRenameInfoEx.
        if (error == 1 || error == 50 || error == 87)
            return MoveFileEx(source, target, 1) ? 0 : Marshal.GetLastWin32Error();
        return error;
    }
}
'@
    }
    $value = @{ protocol = 1; id = $SessionId; state = $State; error = $Message }
    foreach ($key in $Details.Keys) { $value[$key] = $Details[$key] }
    $value = $value | ConvertTo-Json -Compress
    $target = Join-Path $SessionDir 'status.json'
    $temporary = Join-Path $SessionDir ('status-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    [IO.File]::WriteAllText($temporary, $value, [Text.UTF8Encoding]::new($false))
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        $code = [AilsUpdateStatusFile]::Publish($temporary, $target)
        if ($code -eq 0) { return }
        # A reader without delete sharing or a scanner may delay the rename.
        # Keep the previous status readable while retrying a bounded interval.
        if ($code -notin @(5, 32, 33) -or $timer.ElapsedMilliseconds -ge 5000) {
            throw [ComponentModel.Win32Exception]::new($code, "Could not publish update status (Win32 $code): $target")
        }
        Start-Sleep -Milliseconds 25
    } while ($true)
}

function Assert-NoLinks([string]$Target, [Collections.Generic.HashSet[string]]$CheckedDirectories = $null) {
    # Avoid PowerShell provider object construction for every file and ancestor.
    # During one verification pass, inspect each shared ancestor once and check
    # all of them again before readiness. Leaf files are always checked.
    $current = [IO.Path]::GetFullPath($Target)
    $leaf = $true
    while ($current) {
        if (!$leaf -and $null -ne $CheckedDirectories -and $CheckedDirectories.Contains($current)) { break }
        $attributes = [IO.File]::GetAttributes($current)
        if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Linked update path is not supported: $Target" }
        if ($null -ne $CheckedDirectories -and ($attributes -band [IO.FileAttributes]::Directory)) { [void]$CheckedDirectories.Add($current) }
        $current = [IO.Path]::GetDirectoryName($current)
        $leaf = $false
    }
}

function Get-OriginalProcess {
    # NSIS invokes 32-bit PowerShell, which cannot read a 64-bit Electron
    # process's MainModule. CIM exposes the executable and creation time in both.
    $parentPid = [int]$request.parentPid
    if ($parentPid -le 0) { throw 'Invalid original process ID.' }
    $candidate = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $parentPid"
    if ($null -eq $candidate) { return $null }
    if ($candidate.ExecutablePath -ine $request.executablePath) { return $null }
    if ($request.parentStartTicks -and $candidate.CreationDate.ToUniversalTime().Ticks.ToString() -ne $request.parentStartTicks) { return $null }
    return $candidate
}

function Assert-OwnedPaths {
    # Every move/delete is limited to these exact siblings of the installed app.
    $parent = [IO.Path]::GetDirectoryName($InstallDir)
    if ($stageDir -ine "$InstallDir.ails-update-$SessionId" -or $backupDir -ine "$InstallDir.ails-previous-$SessionId" -or
        [IO.Path]::GetDirectoryName($stageDir) -ine $parent -or [IO.Path]::GetDirectoryName($backupDir) -ine $parent) {
        throw 'Update directories escaped the installation parent.'
    }
    Assert-NoLinks $parent
    foreach ($target in @($InstallDir, $stageDir, $backupDir)) {
        if (Test-Path -LiteralPath $target) { Assert-NoLinks $target }
    }
}

try {
    if ($SessionId -cnotmatch '^[a-f0-9]{32}$' -or [IO.Path]::GetFileName($SessionDir) -cne $SessionId) { throw 'Invalid update session.' }
    $SessionDir = [IO.Path]::GetFullPath($SessionDir)
    $InstallDir = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
    if ([IO.Path]::GetPathRoot($InstallDir).TrimEnd('\') -ieq $InstallDir) { throw 'An installation root is required.' }
    Assert-NoLinks $SessionDir
    $request = Get-Content -LiteralPath (Join-Path $SessionDir 'request.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($request.protocol -ne 1 -or $request.id -cne $SessionId -or $request.nonce -cnotmatch '^[a-f0-9]{64}$' -or
        $request.installDir -ine $InstallDir -or $request.executablePath -ine (Join-Path $InstallDir $ExecutableName) -or
        $request.expectedVersion -cne $Version -or [IO.Path]::GetFileName($ExecutableName) -ne $ExecutableName) {
        throw 'The update request does not match this installer.'
    }
    $stageDir = "$InstallDir.ails-update-$SessionId"
    $backupDir = "$InstallDir.ails-previous-$SessionId"
    Assert-OwnedPaths
    $contextFile = Join-Path $SessionDir 'validated.json'
    if ($Phase -eq 'Initialize') {
        $original = Get-OriginalProcess
        if ($null -eq $original) { throw 'The original AILS process is no longer running.' }
        if ((Test-Path -LiteralPath $stageDir) -or (Test-Path -LiteralPath $backupDir)) { throw 'Update directories already exist.' }
        $request | Add-Member -NotePropertyName parentStartTicks -NotePropertyValue $original.CreationDate.ToUniversalTime().Ticks.ToString()
        $request | ConvertTo-Json -Compress | Set-Content -LiteralPath $contextFile -Encoding UTF8
        New-Item -ItemType Directory -Path $stageDir | Out-Null
        Write-Status 'extracting'
        exit 0
    }
    $validated = Get-Content -LiteralPath $contextFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($validated.id -cne $request.id -or $validated.nonce -cne $request.nonce -or $validated.executablePath -ine $request.executablePath -or
        $validated.parentPid -ne $request.parentPid) { throw 'The update request changed during installation.' }
    $request = $validated
    if (Test-Path -LiteralPath (Join-Path $SessionDir 'cancel')) { throw 'Update cancelled; the installed version is unchanged.' }

    if ($Phase -eq 'Tools') {
        Write-Status 'tools'
        if ($RequireFfmpeg) {
            $oldTools = Join-Path $InstallDir 'resources\backend\AILSBackend\tools\ffmpeg'
            $newTools = Join-Path $stageDir 'resources\backend\AILSBackend\tools\ffmpeg'
            # Use the same pair check and verified copy as normal installation.
            # A partial destination must not prevent reuse of both old tools.
            & "$PSHOME\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'reuse-ffmpeg.ps1') -SourceDir $oldTools -DestinationDir $newTools
            if ($LASTEXITCODE -ne 0) { throw 'The installed FFmpeg could not be reused; the installed version is unchanged.' }
        }
        exit 0
    }

    Write-Status 'verifying'
    $manifest = Get-Content -LiteralPath (Join-Path $stageDir 'ails-update-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.protocol -ne 1 -or $manifest.version -cne $Version -or $manifest.executable -cne $ExecutableName -or !$manifest.files.Count) {
        throw 'The extracted update manifest does not match this release.'
    }
    $seen = @{}
    $checkedDirectories = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $cancelPath = [IO.Path]::Combine($SessionDir, 'cancel')
    $hashAlgorithm = [Security.Cryptography.SHA256]::Create()
    $verificationTimer = [Diagnostics.Stopwatch]::StartNew()
    $reportedAt = 0L
    $verifiedFiles = 0
    try { foreach ($entry in $manifest.files) {
        if ([IO.File]::Exists($cancelPath)) { throw 'Update cancelled; the installed version is unchanged.' }
        $file = [IO.Path]::GetFullPath([IO.Path]::Combine($stageDir, [string]$entry.path))
        if (!$file.StartsWith("$stageDir\", [StringComparison]::OrdinalIgnoreCase) -or $seen.ContainsKey($file)) { throw "Invalid update file: $($entry.path)" }
        Assert-NoLinks $file $checkedDirectories
        $stream = [IO.File]::OpenRead($file)
        try {
            if ($stream.Length -ne $entry.size) { throw "Update file verification failed: $($entry.path)" }
            $hash = [BitConverter]::ToString($hashAlgorithm.ComputeHash($stream)).Replace('-', '')
        }
        finally { $stream.Dispose() }
        if ($hash -ine $entry.sha256) { throw "Update file verification failed: $($entry.path)" }
        $seen[$file] = $true
        $verifiedFiles++
        if ($verificationTimer.ElapsedMilliseconds - $reportedAt -ge 500) {
            Write-Status 'verifying' '' @{ verifiedFiles = $verifiedFiles; totalFiles = $manifest.files.Count; elapsedMs = $verificationTimer.ElapsedMilliseconds }
            $reportedAt = $verificationTimer.ElapsedMilliseconds
        }
    } } finally { $hashAlgorithm.Dispose() }
    foreach ($directory in $checkedDirectories) {
        $attributes = [IO.File]::GetAttributes($directory)
        if (($attributes -band [IO.FileAttributes]::ReparsePoint) -or !($attributes -band [IO.FileAttributes]::Directory)) { throw "Update directory changed during verification: $directory" }
    }
    foreach ($required in @($ExecutableName, 'resources\app.asar', 'resources\backend\AILSBackend\AILSBackend.exe')) {
        if (!$seen.ContainsKey((Join-Path $stageDir $required))) { throw "Required update file is missing: $required" }
    }
    if (!(Test-Path -LiteralPath (Join-Path $stageDir "Uninstall $([IO.Path]::GetFileNameWithoutExtension($ExecutableName)).exe"))) {
        throw 'The new uninstaller is missing.'
    }
    if ($RequireFfmpeg) {
        foreach ($tool in @('ffmpeg.exe', 'ffprobe.exe')) {
            if (!(Test-Path -LiteralPath (Join-Path $stageDir "resources\backend\AILSBackend\tools\ffmpeg\bin\$tool"))) { throw "FFmpeg installation is incomplete: $tool" }
        }
    }
    Write-Status 'ready'
    $deadline = [DateTime]::UtcNow.AddMinutes(2)
    $commitFile = Join-Path $SessionDir 'commit.json'
    while (!(Test-Path -LiteralPath $commitFile)) {
        if ((Test-Path -LiteralPath (Join-Path $SessionDir 'cancel')) -or $null -eq (Get-OriginalProcess) -or [DateTime]::UtcNow -gt $deadline) {
            # CIM may finish after Electron wrote commit and exited. Recheck
            # the atomic handoff before treating that normal exit as a cancel.
            if (!(Test-Path -LiteralPath (Join-Path $SessionDir 'cancel')) -and (Test-Path -LiteralPath $commitFile)) { break }
            throw 'Update handoff was cancelled; the installed version is unchanged.'
        }
        Start-Sleep -Milliseconds 200
    }
    $commit = Get-Content -LiteralPath $commitFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($commit.id -cne $SessionId -or $commit.nonce -cne $request.nonce) { throw 'Invalid update handoff.' }
    $handoffAccepted = $true

    # Never terminate the user's app. Electron closes itself only after ready.
    # Wait for its renderers/backend to release the installation directory.
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    do {
        $running = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith("$InstallDir\", [StringComparison]::OrdinalIgnoreCase) })
        if ($running.Count -eq 0 -and $null -eq (Get-OriginalProcess)) { break }
        if ([DateTime]::UtcNow -gt $deadline) { throw 'AILS did not close; the installed version is unchanged.' }
        Start-Sleep -Milliseconds 200
    } while ($true)
    Assert-OwnedPaths
    # Capture the final state after the old process has released its files.
    # Taking this snapshot during extraction would lose edits made at handoff.
    if (!(Test-Path -LiteralPath $UserStateScript -PathType Leaf)) { throw 'The user-state migration helper is missing.' }
    Write-Status 'backing-up'
    $backupLog = Join-Path $SessionDir 'user-state-backup-error.log'
    $userStateBackup = & "$PSHOME\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $UserStateScript -Phase Backup -InstallDir $InstallDir -BackupBase (Join-Path $env:LOCALAPPDATA 'AILS\backups') 2> $backupLog
    if ($LASTEXITCODE -ne 0) { throw "User-state backup failed; the installed version is unchanged. See $backupLog" }
    if ($userStateBackup) {
        & "$PSHOME\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $UserStateScript -Phase Restore -InstallDir $stageDir -BackupDir ([string]$userStateBackup)
        if ($LASTEXITCODE -ne 0) { throw 'User-state restore failed; the previous version and verified backup are retained.' }
    }
    Move-Item -LiteralPath $InstallDir -Destination $backupDir
    $movedOld = $true
    Move-Item -LiteralPath $stageDir -Destination $InstallDir
    $switched = $true
    Write-Status 'installed'
    exit 0
} catch {
    $message = $_.Exception.Message
    if ($switched) {
        try {
            Assert-OwnedPaths
            Move-Item -LiteralPath $InstallDir -Destination $stageDir
            $switched = $false
        } catch { $message += " The new installation is at $InstallDir; the previous version is at $backupDir. $($_.Exception.Message)" }
    }
    if ($movedOld -and !$switched) {
        try {
            Assert-OwnedPaths
            Move-Item -LiteralPath $backupDir -Destination $InstallDir
            $movedOld = $false
        } catch { $message += " Restore the previous installation from $backupDir. $($_.Exception.Message)" }
    }
    try { Write-Status 'error' $message } catch { }
    if ($validated -and !$movedOld -and !$switched -and (Test-Path -LiteralPath $stageDir)) {
        try {
            Assert-OwnedPaths
            if (@(Get-ChildItem -LiteralPath $stageDir -Recurse -Force -Attributes ReparsePoint).Count -eq 0) {
                Remove-Item -LiteralPath $stageDir -Recurse -Force
            }
        } catch { }
    }
    # If the app already exited but cutover failed, reopen the intact old version.
    if ($handoffAccepted -and !$switched -and !$movedOld -and (Test-Path -LiteralPath $request.executablePath) -and $null -eq (Get-OriginalProcess)) {
        Start-Process -FilePath $request.executablePath -ArgumentList '--updated' -WorkingDirectory $InstallDir -WindowStyle Hidden
    }
    Write-Error $message -ErrorAction Continue
    exit 1
}
