$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
foreach ($module in (Get-ChildItem (Join-Path $root 'importers') -Directory)) {
    if (-not (Test-Path (Join-Path $module.FullName 'manifest.json'))) { continue }
    if (-not (Test-Path (Join-Path $module.FullName 'package.json'))) { continue }
    if (Test-Path (Join-Path $module.FullName 'package-lock.json')) {
        & npm.cmd ci --prefix $module.FullName --no-audit --no-fund
    } else {
        & npm.cmd install --prefix $module.FullName --no-audit --no-fund
    }
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
exit 0
