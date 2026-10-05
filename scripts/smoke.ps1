$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
New-Item -ItemType Directory -Force .tools | Out-Null
$id = 'local.story-tracker-smoke-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$config = Join-Path $root '.tools\smoke-config.json'
[System.IO.File]::WriteAllText($config, ('{"identifier":"' + $id + '"}'))
$env:STORY_TRACKER_SMOKE_DATA_DIR = Join-Path ([Environment]::GetFolderPath('ApplicationData')) $id
$env:STORY_TRACKER_SMOKE_EXE = Join-Path $root 'src-tauri\target\release\story-tracker.exe'
try {
    & "$PSScriptRoot\desktop.ps1" build --no-bundle --config $config
    if ($LASTEXITCODE -ne 0) { throw 'Smoke test build failed' }
    & node tests/windows-smoke.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Desktop smoke test failed' }
} finally {
    Remove-Item Env:STORY_TRACKER_SMOKE_DATA_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:STORY_TRACKER_SMOKE_EXE -ErrorAction SilentlyContinue
    # Restore a normal build after testing the isolated application identifier.
    & "$PSScriptRoot\desktop.ps1" build --no-bundle
    if ($LASTEXITCODE -ne 0) { throw 'Normal application rebuild failed' }
}
