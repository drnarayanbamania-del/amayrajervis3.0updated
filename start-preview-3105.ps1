$ErrorActionPreference = 'Stop'

# Thread-local AMAYRA preview server on port 3105 (port 3000 is owned by
# another thread's preview; AMAYRA_PORT is the documented override).

$amayraDir = 'C:\Users\drnar\Documents\Default Project\sakeera-jarvis\.freebuff\amayra-replica\AMAYRA'
$dataDir   = Join-Path $amayraDir '.amayra-data'
$log       = 'C:\Users\drnar\Documents\Default Project\sakeera-jarvis\.freebuff\amayra-preview-3105.log'

$env:NODE_ENV = 'production'
$env:AMAYRA_DATA_DIR = $dataDir
$env:AMAYRA_COGNITION_DATA_DIR = $dataDir
$env:AMAYRA_PORT = '3105'

$proc = Start-Process -FilePath 'node.exe' `
  -ArgumentList 'dist\server.cjs' `
  -WorkingDirectory $amayraDir `
  -RedirectStandardOutput $log `
  -RedirectStandardError "$log.err" `
  -WindowStyle Hidden -PassThru

Write-Output ("AMAYRA preview server started, PID " + $proc.Id)
