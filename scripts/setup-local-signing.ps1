[CmdletBinding()]
param(
  [string]$OutputDir = (Join-Path $HOME ".hana-local-signing"),
  [string]$KeyId = "local-ephemeral",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$keygenScript = Join-Path $PSScriptRoot "artifact-keygen.mjs"
$keyPath = Join-Path $OutputDir "sign-key.pem"
$keyEntryPath = Join-Path $OutputDir "key-entry.json"
$keysetPath = Join-Path $OutputDir "keyset.json"
$envScriptPath = Join-Path $OutputDir "env.ps1"

if (-not (Test-Path -LiteralPath $keygenScript -PathType Leaf)) {
  throw "Key generator not found: $keygenScript"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$existingFiles = @(
  @($keyPath, $keyEntryPath, $keysetPath, $envScriptPath) |
    Where-Object { Test-Path -LiteralPath $_ }
)

if ($existingFiles.Count -gt 0 -and -not $Force) {
  if ((Test-Path -LiteralPath $keyPath) -and (Test-Path -LiteralPath $keysetPath)) {
    Write-Host "Local signing key already exists; keeping it unchanged." -ForegroundColor Yellow
  } else {
    throw "Local signing files are incomplete in '$OutputDir'. Re-run with -Force to regenerate them."
  }
} else {
  if ($Force) {
    Remove-Item -LiteralPath $keyPath, $keyEntryPath, $keysetPath, $envScriptPath `
      -Force -ErrorAction SilentlyContinue
  }

  Push-Location $repoRoot
  try {
    $keyEntryJson = & node $keygenScript --out $keyPath --key-id $KeyId
    if ($LASTEXITCODE -ne 0) {
      throw "artifact-keygen.mjs failed with exit code $LASTEXITCODE"
    }
    [System.IO.File]::WriteAllText($keyEntryPath, ($keyEntryJson -join [Environment]::NewLine) + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))

    & node -e @"
const fs = require('fs');
const entry = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
fs.writeFileSync(process.argv[2], JSON.stringify([entry], null, 2) + '\n');
"@ $keyEntryPath $keysetPath
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to create keyset.json (exit code $LASTEXITCODE)"
    }
  } finally {
    Pop-Location
  }

  Write-Host "Created a local signing keypair." -ForegroundColor Green
}

$escapedKeyPath = $keyPath.Replace("'", "''")
$escapedKeysetPath = $keysetPath.Replace("'", "''")
@"
`$env:HANA_SIGN_KEY = '$escapedKeyPath'
`$env:HANA_SIGN_KEYSET = '$escapedKeysetPath'
"@ | Set-Content -LiteralPath $envScriptPath -Encoding utf8

$env:HANA_SIGN_KEY = $keyPath
$env:HANA_SIGN_KEYSET = $keysetPath

Write-Host ""
Write-Host "Private key: $keyPath"
Write-Host "Keyset:     $keysetPath"
Write-Host ""
Write-Host "The variables are active in this script process only." -ForegroundColor Cyan
Write-Host "To load them into your current PowerShell session, run:"
Write-Host ". '$envScriptPath'" -ForegroundColor White
Write-Host "Then run: npm run pack" -ForegroundColor White
Write-Host ""
Write-Warning "This is a local throwaway key. Do not use it for production releases."
