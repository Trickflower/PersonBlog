$ErrorActionPreference = 'Stop'
$stateFile = Join-Path $PSScriptRoot 'private/logs/processes.json'
if (-not (Test-Path -LiteralPath $stateFile)) { Write-Output 'No managed services found.'; return }
$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
foreach ($entry in @(@{ id = $state.studio; script = 'scripts/studio/server.mjs' }, @{ id = $state.preview; script = 'scripts/preview.mjs' })) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($entry.id)" -ErrorAction SilentlyContinue
    if ($process -and $process.Name -eq 'node.exe' -and $process.CommandLine.Contains($entry.script)) {
        Stop-Process -Id $entry.id
    }
}
Write-Output 'Managed PersonBlog services stopped.'
