param(
    [ValidateSet('dev', 'build', 'test')]
    [string]$Task = 'dev',
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExtraArgs
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$localCargo = Join-Path $root '.tools\cargo'
if (Test-Path (Join-Path $localCargo 'bin\cargo.exe')) {
    $env:CARGO_HOME = $localCargo
    $env:RUSTUP_HOME = Join-Path $root '.tools\rustup'
    $env:PATH = (Join-Path $localCargo 'bin') + ';' + $env:PATH
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw 'Rust/Cargo is missing. Install the Windows MSVC Rust toolchain first.'
}
if ($Task -eq 'test') {
    & cargo test --manifest-path src-tauri/Cargo.toml --no-default-features @ExtraArgs
} elseif ($Task -eq 'dev') {
    $env:STORY_TRACKER_IMPORTERS_DIR = Join-Path $root 'importers'
    & npm.cmd run tauri -- dev @ExtraArgs
} else {
    & npm.cmd run tauri -- build @ExtraArgs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $profile = if ($ExtraArgs -contains '--debug') { 'debug' } else { 'release' }
    & "$PSScriptRoot\sync-importers.ps1" -Destination (Join-Path $root "src-tauri\target\$profile\importers")
}
exit $LASTEXITCODE
