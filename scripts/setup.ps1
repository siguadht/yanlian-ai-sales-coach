$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
    throw "Python launcher 'py' is required. Install Python 3.12 first."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js 22+ is required."
}
if (-not (Test-Path "$ProjectDir\.env")) {
    Copy-Item "$ProjectDir\.env.example" "$ProjectDir\.env"
    Write-Host "Created .env from .env.example. Fill in your own credentials before starting the app."
}

& py -3.12 -m venv "$ProjectDir\backend\.venv"
& "$ProjectDir\backend\.venv\Scripts\python.exe" -m pip install -r "$ProjectDir\backend\requirements.txt"
Push-Location "$ProjectDir\frontend"
try { npm ci } finally { Pop-Location }

Write-Host "Setup complete. Edit .env, then run .\scripts\dev.ps1"
