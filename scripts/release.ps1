$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$previousTarget = $env:CARGO_TARGET_DIR
$previousFlags = $env:CARGO_ENCODED_RUSTFLAGS
$previousExe = $env:STORY_TRACKER_RELEASE_EXE
try {
    & node "$PSScriptRoot\license-notices.mjs"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $env:CARGO_TARGET_DIR = Join-Path $root 'src-tauri\target\portable'
    $flags = @("--remap-path-prefix=$root=/source/story-tracker", '-C', 'link-arg=/PDBALTPATH:story-tracker.pdb')
    if ($env:USERPROFILE) { $flags += "--remap-path-prefix=$env:USERPROFILE=/user" }
    $encoded = [string]::Join([char]31, $flags)
    $env:CARGO_ENCODED_RUSTFLAGS = if ($previousFlags) { $previousFlags + [char]31 + $encoded } else { $encoded }
    & "$PSScriptRoot\desktop.ps1" build --no-bundle --config src-tauri/tauri.portable.conf.json
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $env:STORY_TRACKER_RELEASE_EXE = Join-Path $env:CARGO_TARGET_DIR 'release\story-tracker.exe'
    $package = & node "$PSScriptRoot\package-release.mjs"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $package = [string]$package
    $archive = "$package.zip"
    Compress-Archive -LiteralPath $package -DestinationPath $archive
    Write-Output "Release folder: $package"
    Write-Output "Release archive: $archive"
} finally {
    $env:CARGO_TARGET_DIR = $previousTarget
    $env:CARGO_ENCODED_RUSTFLAGS = $previousFlags
    $env:STORY_TRACKER_RELEASE_EXE = $previousExe
}
