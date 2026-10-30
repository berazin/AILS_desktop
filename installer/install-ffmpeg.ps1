param(
    [Parameter(Mandatory = $true)]
    [string]$ArchivePath,
    [Parameter(Mandatory = $true)]
    [string]$ChecksumPath,
    [Parameter(Mandatory = $true)]
    [string]$Destination
)

$ErrorActionPreference = "Stop"

$expectedHash = (Get-Content -LiteralPath $ChecksumPath -Raw).Trim().Split()[0].ToUpperInvariant()
if ($expectedHash -notmatch "^[A-F0-9]{64}$") {
    throw "The FFmpeg checksum file is invalid."
}

$actualHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToUpperInvariant()
if ($actualHash -ne $expectedHash) {
    throw "The downloaded FFmpeg archive failed SHA-256 verification."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
try {
    $wantedFiles = @{
        "ffmpeg.exe" = Join-Path $Destination "bin\ffmpeg.exe"
        "ffprobe.exe" = Join-Path $Destination "bin\ffprobe.exe"
        "LICENSE" = Join-Path $Destination "LICENSE"
        "README.txt" = Join-Path $Destination "README.txt"
    }

    New-Item -ItemType Directory -Path (Join-Path $Destination "bin") -Force | Out-Null
    $extractedExecutables = 0
    foreach ($entry in $archive.Entries) {
        if (-not $wantedFiles.ContainsKey($entry.Name)) {
            continue
        }
        $normalizedEntryPath = $entry.FullName.Replace([char]92, [char]47)
        if ($entry.Name -in @("ffmpeg.exe", "ffprobe.exe") -and $normalizedEntryPath -notmatch "/bin/[^/]+$") {
            continue
        }
        $targetPath = $wantedFiles[$entry.Name]
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $targetPath, $true)
        if ($entry.Name -in @("ffmpeg.exe", "ffprobe.exe")) {
            $extractedExecutables += 1
        }
    }

    if ($extractedExecutables -ne 2) {
        throw "The FFmpeg archive does not contain ffmpeg.exe and ffprobe.exe."
    }
}
finally {
    $archive.Dispose()
}
