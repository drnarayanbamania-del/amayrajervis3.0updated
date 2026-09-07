$ErrorActionPreference = 'Stop'

# Standalone AMAYRA preview server launcher (per run doc).
# Electron shell and this server are mutually exclusive on port 3000:
# stop the Electron tree first (taskkill /PID <backend-pid> /T /F via PowerShell).

$amayraDir = Join-Path $PSScriptRoot 'AMAYRA'
$dataDir   = Join-Path $amayraDir '.amayra-data'
$log       = 'C:\Users\drnar\Documents\Default Project\sakeera-jarvis\.freebuff\preview-627c0faf-b180-47e3-8a2a-2d769e2019d9.log'

$env:NODE_ENV = 'production'
$env:AMAYRA_DATA_DIR = $dataDir
$env:AMAYRA_COGNITION_DATA_DIR = $dataDir

$proc = Start-Process -FilePath 'node.exe' `
  -ArgumentList 'dist\server.cjs' `
  -WorkingDirectory $amayraDir `
  -RedirectStandardOutput $log `
  -RedirectStandardError "$log.err" `
  -WindowStyle Hidden -PassThru

Write-Output ("AMAYRA preview server started, PID " + $proc.Id)
