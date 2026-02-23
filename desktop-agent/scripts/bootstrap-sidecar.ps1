param(
  [string]$Python = "python",
  [int]$Port = 8765
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$venvDir = Join-Path $repoRoot ".venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$requirements = Join-Path $repoRoot "sidecar\requirements.txt"
$serviceScript = Join-Path $repoRoot "sidecar\uia_service.py"

if (-not (Test-Path $venvPython)) {
  Write-Host "[sidecar] creating venv at $venvDir"
  & $Python -m venv $venvDir
}

Write-Host "[sidecar] installing requirements"
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r $requirements

Write-Host "[sidecar] validating imports"
& $venvPython -c "import fastapi, uvicorn, pywinauto; print('sidecar_imports_ok')"

Write-Host "[sidecar] starting service on port $Port"
Start-Process -FilePath $venvPython -ArgumentList @($serviceScript, "--port", "$Port") -WorkingDirectory $repoRoot -WindowStyle Hidden

Start-Sleep -Seconds 2
try {
  $health = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 4
  Write-Host "[sidecar] health endpoint status $($health.StatusCode)"
} catch {
  Write-Warning "[sidecar] started but health check failed: $($_.Exception.Message)"
}
