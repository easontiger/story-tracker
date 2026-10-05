param([Parameter(Mandatory = $true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$source = Join-Path $root 'importers'
New-Item -ItemType Directory -Force $Destination | Out-Null
$stateFile = Join-Path $Destination '.deployed.json'
$previous = @()
if (Test-Path $stateFile) {
    $decoded = Get-Content $stateFile -Raw | ConvertFrom-Json
    foreach ($item in $decoded) {
        if ($item -isnot [string]) { throw 'Invalid deployment state' }
        $previous += $item
    }
}
$modules = @(Get-ChildItem $source -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'manifest.json') })
foreach ($name in $previous) {
    if ($name -notmatch '^[a-z0-9_-]{1,64}$') { throw 'Invalid deployment state' }
    if ($name -notin $modules.Name) {
        $old = Join-Path $Destination $name
        if (Test-Path $old) { Remove-Item -LiteralPath $old -Recurse -Force }
    }
}
foreach ($module in $modules) {
    Copy-Item -LiteralPath $module.FullName -Destination $Destination -Recurse -Force
}
$names = @($modules | ForEach-Object { $_.Name })
[System.IO.File]::WriteAllText($stateFile, (ConvertTo-Json -InputObject $names))
