$ErrorActionPreference = 'Stop'

# Compile the AMAYRA Electron launcher (electron/launcher.cs) without csc.exe:
# Add-Type uses the .NET compiler in-process, avoiding native argv entirely.
$amayraDir = Join-Path $PSScriptRoot 'AMAYRA'
$source = Get-Content -Raw (Join-Path $amayraDir 'electron\launcher.cs')
$outExe = Join-Path $amayraDir 'build\AMAYRA-launcher.exe'

if (Test-Path $outExe) { Remove-Item $outExe -Force }

Add-Type -TypeDefinition $source `
  -OutputAssembly $outExe `
  -OutputType WindowsApplication `
  -ReferencedAssemblies @('System.Windows.Forms', 'System.dll')

$exe = Get-Item $outExe
Write-Output ("LAUNCHER OK: " + $exe.FullName + " (" + [Math]::Round($exe.Length/1KB, 1) + " KB)")
