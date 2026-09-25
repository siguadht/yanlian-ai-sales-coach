$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path "$ProjectDir\.env")) {
    throw "Missing .env. Run .\scripts\setup.ps1 first."
}
if (-not (Test-Path "$ProjectDir\backend\.venv\Scripts\python.exe")) {
    throw "Backend dependencies are missing. Run .\scripts\setup.ps1 first."
}
if (-not (Test-Path "$ProjectDir\frontend\node_modules")) {
    throw "Frontend dependencies are missing. Run .\scripts\setup.ps1 first."
}

$Backend = Start-Process `
    -FilePath "$ProjectDir\backend\.venv\Scripts\python.exe" `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "18011" `
    -WorkingDirectory "$ProjectDir\backend" `
    -PassThru

try {
    $env:BACKEND_URL = "http://127.0.0.1:18011"
    $env:NEXT_PUBLIC_BACKEND_WS_ORIGIN = "ws://127.0.0.1:18011"
    Push-Location "$ProjectDir\frontend"
    try { npm run dev -- --hostname 127.0.0.1 --port 3000 } finally { Pop-Location }
}
finally {
    Stop-Process -Id $Backend.Id -ErrorAction SilentlyContinue
}
