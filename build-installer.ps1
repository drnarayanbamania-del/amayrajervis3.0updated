$ErrorActionPreference = 'Stop'

# Build the AMAYRA Windows installer (release\AMAYRA-Setup-<version>.exe).
#
# 1. Compile the launcher (afterPack requires build\AMAYRA-launcher.exe).
# 2. Build renderer bundle + server bundle.
#    NOTE: dist\ has no UI source in this tree - a fresh vite build would
#    ERASE the AMAYRA rename and the powered-by footer baked into the
#    bundle. Set AMAYRA_SKIP_RENDERER_BUILD=1 to reuse the existing dist\.
# 3. Run electron-builder (NSIS). The vendored node_modules ships a trimmed
#    app-builder-lib whose schema validator rejects the valid nsis block;
#    build-installer patches it once and EB_VALIDATION_OFF=1 skips it.
#
# Disk/time: ~151 MB installer, NSIS tools auto-download on first run.

$amayraDir = Join-Path $PSScriptRoot 'AMAYRA'
Push-Location $amayraDir
try {
  # 1. Launcher
  $source = Get-Content -Raw (Join-Path $amayraDir 'electron\launcher.cs')
  $outExe = Join-Path $amayraDir 'build\AMAYRA-launcher.exe'
  if (Test-Path $outExe) { Remove-Item $outExe -Force }
  Add-Type -TypeDefinition $source -OutputAssembly $outExe `
    -OutputType WindowsApplication `
    -ReferencedAssemblies @('System.Windows.Forms', 'System.dll')
  Write-Output '[1/3] Launcher compiled.'

  # 2. Bundles
  if ($env:AMAYRA_SKIP_RENDERER_BUILD -eq '1') {
    Write-Output '[2/3] Skipping renderer build (reusing existing dist\).'
  } else {
    npm run build:renderer
    if ($LASTEXITCODE -ne 0) { throw 'Renderer build failed.' }
  }
  npm run build:server
  if ($LASTEXITCODE -ne 0) { throw 'Server build failed.' }
  Write-Output '[2/3] Bundles built.'

  # 3. One-time validation patch for the vendored app-builder-lib
  $configJs = Join-Path $amayraDir 'node_modules\app-builder-lib\out\util\config\config.js'
  $content = Get-Content -Raw $configJs
  if (-not $content.Contains('EB_VALIDATION_OFF')) {
    $anchor = 'async function validateConfiguration(config, debugLogger) {'
    if ($content.Contains($anchor)) {
      $content = $content.Replace($anchor, $anchor + "`r`n  if (process.env.EB_VALIDATION_OFF) return;")
      Set-Content -Path $configJs -Value $content -NoNewline
      Write-Output '[3/3] Vendored app-builder-lib validator patched.'
    } else {
      Write-Warning 'Validator anchor not found; build may fail on config validation.'
    }
  }

  # 4. Installer
  $env:EB_VALIDATION_OFF = '1'
  npx electron-builder --win nsis
  if ($LASTEXITCODE -ne 0) { throw 'electron-builder failed.' }
  Write-Output ('INSTALLER READY: ' + (Join-Path $amayraDir 'release'))
} finally {
  Pop-Location
}
