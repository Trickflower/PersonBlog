$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$nodePath = (Get-Command node).Source
$ports = @(4312, 4311)
foreach ($port in $ports) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $port is already in use. Stop the existing process or run npm run dev / npm run preview with another port."
    }
}
& npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
$logDir = Join-Path $PSScriptRoot 'private/logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$studioProcess = Start-Process -FilePath $nodePath -ArgumentList '--env-file-if-exists=.env', 'scripts/studio/server.mjs' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'studio.log') -RedirectStandardError (Join-Path $logDir 'studio-error.log')
$previewProcess = Start-Process -FilePath $nodePath -ArgumentList 'scripts/preview.mjs' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'preview.log') -RedirectStandardError (Join-Path $logDir 'preview-error.log')
@{ studio = $studioProcess.Id; preview = $previewProcess.Id; root = $PSScriptRoot } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logDir 'processes.json')
Write-Output 'Studio: http://127.0.0.1:4312'
Write-Output 'Blog:   http://127.0.0.1:4311'
