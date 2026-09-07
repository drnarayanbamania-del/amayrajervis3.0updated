$ErrorActionPreference = 'Stop'
$app = 'C:\Users\drnar\Documents\Default Project\sakeera-jarvis\.freebuff\amayra-replica\AMAYRA'
$log = 'C:\Users\drnar\Documents\Default Project\sakeera-jarvis\.freebuff\.freebuff\preview-electron.log'

$env:NODE_ENV = 'production'
$env:AMAYRA_DATA_DIR = Join-Path $app '.amayra-data'
$env:AMAYRA_COGNITION_DATA_DIR = Join-Path $app '.amayra-data'
$env:ELECTRON_ENABLE_LOGGING = '1'

$p = Start-Process -FilePath (Join-Path $app 'node_modules\electron\dist\electron.exe') `
  -ArgumentList '.' `
  -WorkingDirectory $app `
  -RedirectStandardOutput $log `
  -RedirectStandardError "$log.err" `
  -PassThru
Write-Output ("PID: " + $p.Id)
