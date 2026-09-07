$ErrorActionPreference = 'Stop'
$app = 'C:\Users\drnar\Documents\Default Project\sakeera-jarvis\.freebuff\amayra-replica\AMAYRA'
$electron = Join-Path $app 'node_modules\electron\dist\electron.exe'
$data = Join-Path $app '.amayra-data'

$cmd = 'cmd.exe /c set "NODE_ENV=production"&& set "AMAYRA_DATA_DIR=' + $data + '"&& set "AMAYRA_COGNITION_DATA_DIR=' + $data + '"&& cd /d "' + $app + '"&& start "" "' + $electron + '" .'

$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = $cmd
  CurrentDirectory = $app
}
Write-Output ("ReturnCode: " + $result.ReturnValue + "  NewProcessId: " + $result.ProcessId)
