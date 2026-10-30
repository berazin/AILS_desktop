param(
    [Parameter(Mandatory=$true)][ValidateSet('Backup','Restore')][string]$Phase,
    [Parameter(Mandatory=$true)][string]$InstallDir,
    [string]$BackupBase,
    [string]$BackupDir
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
function Assert-NoLinks([string]$path, [switch]$PathOnly) {
    $current = [IO.Path]::GetFullPath($path)
    while ($current) {
        if ([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) { throw 'User-state links require manual migration.' }
        $current = [IO.Path]::GetDirectoryName($current)
    }
    if (!$PathOnly -and [IO.Directory]::Exists($path) -and @(Get-ChildItem -LiteralPath $path -Recurse -Force -Attributes ReparsePoint).Count) { throw 'User-state links require manual migration.' }
}
function File-Digest([string]$path) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($path)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
try {
    if ($Phase -eq 'Backup') {
        $backend = Join-Path $root 'resources\backend\AILSBackend'
        if (!(Test-Path -LiteralPath $backend)) { exit 0 }
        # Validate only the container here; each selected source is checked below.
        # Bundled runtimes and unrelated historical backups are not migrated.
        Assert-NoLinks $backend -PathOnly
        $static = @('_internal','audit','tools','__pycache__','AILSBackend.exe','.ails-edition','edition-manifest.json','edition-manifest.sha256')
        $sources = @(Get-ChildItem -LiteralPath $backend -Force | Where-Object { $_.Name -notin $static })
        if (!$sources.Count) { exit 0 }
        $base = [IO.Path]::GetFullPath($BackupBase).TrimEnd('\')
        New-Item -ItemType Directory -Path $base -Force | Out-Null
        Assert-NoLinks $base -PathOnly
        $saved = Join-Path $base ('installer-state-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $saved | Out-Null
        $entries = New-Object 'System.Collections.Generic.List[object]'
        foreach ($source in $sources) {
            Assert-NoLinks $source.FullName
            $relative = 'resources\backend\AILSBackend\' + $source.Name
            $destination = Join-Path $saved $relative
            New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
            Copy-Item -LiteralPath $source.FullName -Destination $destination -Recurse -Force
            $files = @(if ($source.PSIsContainer) { Get-ChildItem -LiteralPath $source.FullName -Recurse -Force -File } else { $source })
            foreach ($file in $files) {
                $name = $file.FullName.Substring($root.Length + 1)
                $hash = File-Digest $file.FullName
                $copy = Join-Path $saved $name
                if ((Get-Item -LiteralPath $copy).Length -ne $file.Length -or (File-Digest $copy) -cne $hash) { throw 'User-state backup verification failed; installation must not continue.' }
                $entries.Add(@{ path=$name; size=$file.Length; sha256=$hash })
            }
        }
        @{ protocol=1; source=$root; roots=@($sources | ForEach-Object { 'resources\backend\AILSBackend\' + $_.Name }); files=$entries.ToArray() } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $saved 'user-state.json') -Encoding UTF8
        Write-Output $saved
        exit 0
    }
    if (!$BackupDir) { exit 0 }
    $saved = [IO.Path]::GetFullPath($BackupDir.Trim()).TrimEnd('\')
    Assert-NoLinks $saved
    $index = Get-Content -LiteralPath (Join-Path $saved 'user-state.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($index.protocol -ne 1) { throw 'Invalid user-state backup.' }
    $payload = @{}
    $verifiedFiles = @{}
    $manifestPath = Join-Path $root 'ails-update-manifest.json'
    if (Test-Path -LiteralPath $manifestPath) {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($entry in $manifest.files) { $payload[[IO.Path]::GetFullPath((Join-Path $root $entry.path))] = $true }
    }
    foreach ($entry in $index.files) {
        $source = [IO.Path]::GetFullPath((Join-Path $saved $entry.path))
        $destination = [IO.Path]::GetFullPath((Join-Path $root $entry.path))
        if (!$source.StartsWith("$saved\resources\backend\AILSBackend\",[StringComparison]::OrdinalIgnoreCase) -or !$destination.StartsWith("$root\resources\backend\AILSBackend\",[StringComparison]::OrdinalIgnoreCase) -or $payload.ContainsKey($destination) -or $verifiedFiles.ContainsKey($source)) { throw 'Unsafe user-state path or packaged-file collision.' }
        Assert-NoLinks $source
        if ((Get-Item -LiteralPath $source).Length -ne $entry.size -or (File-Digest $source) -cne $entry.sha256) { throw 'User-state backup was modified.' }
        $verifiedFiles[$source] = $true
    }
    # Verify every root before any writes. Do not recursively copy files that
    # were added to a backup after its verified index was recorded.
    foreach ($relative in $index.roots) {
        $source = [IO.Path]::GetFullPath((Join-Path $saved $relative))
        $destination = [IO.Path]::GetFullPath((Join-Path $root $relative))
        if (!$source.StartsWith("$saved\resources\backend\AILSBackend\",[StringComparison]::OrdinalIgnoreCase) -or !$destination.StartsWith("$root\resources\backend\AILSBackend\",[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe user-state root.' }
        Assert-NoLinks $source
        $item = Get-Item -LiteralPath $source
        $files = @(if ($item.PSIsContainer) { Get-ChildItem -LiteralPath $source -Recurse -Force -File } else { $item })
        foreach ($file in $files) { if (!$verifiedFiles.ContainsKey($file.FullName)) { throw 'User-state backup contains an unverified file.' } }
        if (Test-Path -LiteralPath $destination) { Assert-NoLinks $destination }
    }
    foreach ($relative in $index.roots) {
        $source = Join-Path $saved $relative
        $destination = Join-Path $root $relative
        New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination ([IO.Path]::GetDirectoryName($destination)) -Recurse -Force
    }
    foreach ($entry in $index.files) {
        $destination = Join-Path $root $entry.path
        if ((Get-Item -LiteralPath $destination).Length -ne $entry.size -or (File-Digest $destination) -cne $entry.sha256) { throw 'User-state restore verification failed; backup retained.' }
    }
    # Retain the verified private backup for recovery; never sweep user backups.
    exit 0
} catch { Write-Error $_.Exception.Message -ErrorAction Continue; exit 1 }
