param(
    [Parameter(Mandatory=$true)][string]$SourceDir,
    [Parameter(Mandatory=$true)][string]$DestinationDir
)
$ErrorActionPreference = 'Stop'

function Has-Ffmpeg([string]$Root) {
    return (Test-Path -LiteralPath (Join-Path $Root 'bin\ffmpeg.exe') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $Root 'bin\ffprobe.exe') -PathType Leaf)
}

function Assert-NoLinks([string]$Root) {
    $current = $Root
    while ($current) {
        if ((Test-Path -LiteralPath $current) -and
            ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Linked FFmpeg paths cannot be reused.'
        }
        $current = [IO.Path]::GetDirectoryName($current)
    }
    if ((Test-Path -LiteralPath $Root -PathType Container) -and
        @(Get-ChildItem -LiteralPath $Root -Recurse -Force -Attributes ReparsePoint).Count) {
        throw 'Linked FFmpeg files cannot be reused.'
    }
}

function File-Digest([string]$File) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($File)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}

try {
    $source = [IO.Path]::GetFullPath($SourceDir).TrimEnd('\')
    $destination = [IO.Path]::GetFullPath($DestinationDir).TrimEnd('\')
    if (!(Has-Ffmpeg $source) -or (Has-Ffmpeg $destination)) { exit 0 }
    if ($source -ieq $destination -or $source.StartsWith("$destination\", [StringComparison]::OrdinalIgnoreCase) -or
        $destination.StartsWith("$source\", [StringComparison]::OrdinalIgnoreCase)) {
        throw 'FFmpeg source and destination must be separate directories.'
    }
    Assert-NoLinks $source
    Assert-NoLinks $destination
    $files = @(Get-ChildItem -LiteralPath $source -Recurse -Force -File | ForEach-Object {
        @{ path=$_.FullName.Substring($source.Length + 1); size=$_.Length; sha256=(File-Digest $_.FullName) }
    })
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Get-ChildItem -LiteralPath $source -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
    }
    foreach ($file in $files) {
        $copied = Join-Path $destination $file.path
        if ((Get-Item -LiteralPath $copied).Length -ne $file.size -or (File-Digest $copied) -cne $file.sha256) {
            throw 'The installed FFmpeg copy failed verification.'
        }
    }
    if (!(Has-Ffmpeg $destination)) { throw 'The installed FFmpeg copy is incomplete.' }
    Write-Output 'Reusing installed FFmpeg.'
    exit 0
} catch { Write-Error $_.Exception.Message -ErrorAction Continue; exit 1 }
