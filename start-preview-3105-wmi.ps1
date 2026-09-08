$ErrorActionPreference = 'Stop'

# Thread-local AMAYRA preview server on port 3105, spawned via WMI so the
# process tree is fully detached from the calling shell session (plain
# Start-Process children get reaped when the agent's session ends).

$app = 'C:\Users\drnar\Documents\Default Project\sakeera-jarvis\.freebuff\amayra-replica\AMAYRA'
$log = 'C:\Users\drnar\Documents\Default Project\sakeera-jarvis\.freebuff\amayra-preview-3105.log'

$cmd = 'cmd.exe /c set "NODE_ENV=production"&& set "AMAYRA_DATA_DIR=' + $app + '\.amayra-data"&& set "AMAYRA_COGNITION_DATA_DIR=' + $app + '\.amayra-data"&& set "AMAYRA_PORT=3105"&& cd /d "' + $app + '"&& node dist\server.cjs > "' + $log + '" 2> "' + $log + '.err"'

$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = $cmd
  CurrentDirectory = $app
}
Write-Output ("ReturnCode: " + $result.ReturnValue + "  NewProcessId: " + $result.ProcessId)
