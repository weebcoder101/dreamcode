#!/usr/bin/env pwsh
# ───────────────────────────────────────────────────────────────────────
# DreamCode Windows Installer (PowerShell)
#
# Downloads the pre-built binary from GitHub Releases, places it in
# $env:LOCALAPPDATA\dreamcode\bin\, and adds it to the user PATH.
#
# Usage:
#   irm https://raw.githubusercontent.com/weebcoder101/dreamcode/main/install.ps1 | iex
#   .\install.ps1
#
# Or clone + build from source:
#   git clone https://github.com/weebcoder101/dreamcode; cd dreamcode
#   .\install.ps1 -BuildFromSource
# ───────────────────────────────────────────────────────────────────────

param(
  [switch]$BuildFromSource
)

$ErrorActionPreference = "Stop"
$APP = "dreamcode"
$OWNER = "weebcoder101"
$REPO = "dreamcode"
$INSTALL_DIR = if ($env:DREAMCODE_DIR) { $env:DREAMCODE_DIR } else { "$env:USERPROFILE\.dreamcode" }
$BIN_DIR = "$env:LOCALAPPDATA\$APP\bin"

# ─── Colors (approximate) ─────────────────────────────────────────────
$GREEN = "Green"
$CYAN = "Cyan"
$RED = "Red"
$ORANGE = "Yellow"
$MUTED = "DarkGray"
$BOLD = "White"

function Write-Color($text, $color, $bold = $false) {
  if ($bold) { Write-Host $text -ForegroundColor $color }
  else { Write-Host $text -ForegroundColor $color }
}

# ─── Helper: download with progress ───────────────────────────────────
function Download-File($url, $dest) {
  Write-Color "Downloading $url ..." $CYAN
  $wc = New-Object System.Net.WebClient
  $wc.DownloadFile($url, $dest)
}

# ─── Phase 1: Download pre-built binary (default) ─────────────────────
if (-not $BuildFromSource) {
  Write-Color "DreamCode Windows Installer" $BOLD $true
  Write-Color "Downloading latest release..." $CYAN

  # Get latest release from GitHub
  $apiUrl = "https://api.github.com/repos/$OWNER/$REPO/releases/latest"
  try {
    $release = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "dreamcode-installer" }
    $tag = $release.tag_name
    Write-Color "Latest release: $tag" $MUTED
  } catch {
    Write-Color "WARN: Could not fetch latest release. Using v1.2.9." $ORANGE
    $tag = "v1.2.9"
  }

  # Find the windows-x64 asset
  $assetName = "opencode-windows-x64.tar.gz"
  $downloadUrl = "https://github.com/$OWNER/$REPO/releases/download/$tag/$assetName"
  $tempDir = "$env:TEMP\dreamcode-install"
  $tempArchive = "$tempDir\$assetName"
  $extractDir = "$tempDir\extracted"

  New-Item -ItemType Directory -Force -Path $tempDir, $extractDir | Out-Null

  try {
    Download-File $downloadUrl $tempArchive
  } catch {
    Write-Color "ERROR: Failed to download $downloadUrl" $RED
    Write-Color "Falling back to source build (requires git + bun)..." $ORANGE
    $BuildFromSource = $true
  }
}

# ─── Phase 1b: Extract pre-built binary ───────────────────────────────
if (-not $BuildFromSource -and (Test-Path $tempArchive)) {
  Write-Color "Extracting..." $CYAN

  # tar is available on Windows 10 1803+ and Windows 11
  if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
    Write-Color "WARN: tar not found — falling back to source build" $ORANGE
    $BuildFromSource = $true
  } else {
    tar -xzf $tempArchive -C $extractDir 2>$null
  }

  $binaryPath = Get-ChildItem -Recurse -Filter "opencode.exe" -Path $extractDir | Select-Object -First 1
  if (-not $binaryPath) {
    Write-Color "ERROR: Binary not found in extracted archive" $RED
    $BuildFromSource = $true
  } else {
    # Install binary to bin dir
    New-Item -ItemType Directory -Force -Path $BIN_DIR | Out-Null
    Copy-Item $binaryPath.FullName "$BIN_DIR\$APP.exe" -Force
    Write-Color "Installed $APP.exe to $BIN_DIR" $GREEN
  }
}

# ─── Phase 1c: Build from source (fallback or explicit) ───────────────
if ($BuildFromSource) {
  Write-Color "Building from source..." $CYAN

  # Clone or update repo
  if (Test-Path "$INSTALL_DIR\.git") {
    Write-Color "Updating existing DreamCode install..." $CYAN
    git -C $INSTALL_DIR pull
  } else {
    if (Test-Path $INSTALL_DIR) {
      Write-Color "ERROR: $INSTALL_DIR exists but is not a git repo." $RED
      Write-Color "Remove it or set `$env:DREAMCODE_DIR to a different path." $ORANGE
      exit 1
    }
    Write-Color "Cloning DreamCode..." $CYAN
    git clone "https://github.com/$OWNER/$REPO.git" $INSTALL_DIR
  }

  # Check for bun
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Color "Installing bun..." $CYAN
    # Use bun's official PowerShell installer
    $bunInstallScript = Invoke-RestMethod -Uri "https://bun.sh/install.ps1"
    Invoke-Expression ($bunInstallScript)
    $env:Path = "$env:USERPROFILE\.bun\bin;$env:Path"
  }

  # Read version from package.json
  $pkg = Get-Content "$INSTALL_DIR\packages\opencode\package.json" | ConvertFrom-Json
  $VERSION = $pkg.version
  $env:OPENCODE_VERSION = $VERSION
  Write-Color "Building version: $VERSION" $MUTED

  Set-Location $INSTALL_DIR
  bun install

  Set-Location packages\opencode
  bun run build --single --skip-embed-web-ui --skip-install

  # Verify binary
  $NATIVE_BIN = "dist\opencode-windows-x64\bin\opencode.exe"
  if (-not (Test-Path $NATIVE_BIN)) {
    Write-Color "ERROR: Build did not produce expected binary at $NATIVE_BIN" $RED
    exit 1
  }

  # Copy binary
  New-Item -ItemType Directory -Force -Path $BIN_DIR | Out-Null
  Copy-Item $NATIVE_BIN "$BIN_DIR\$APP.exe" -Force
  Write-Color "Installed $APP.exe to $BIN_DIR" $GREEN
}

# ─── Phase 2: Add to user PATH ────────────────────────────────────────
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$BIN_DIR*") {
  [Environment]::SetEnvironmentVariable("Path", "$BIN_DIR;$userPath", "User")
  # Also update current session
  $env:Path = "$BIN_DIR;$env:Path"
  Write-Color "Added $BIN_DIR to user PATH" $GREEN
} else {
  Write-Color "$BIN_DIR already in PATH" $MUTED
}

# ─── Phase 3: Verify ─────────────────────────────────────────────────
Write-Color "" $MUTED
Write-Color ("=" * 50) $GREEN
Write-Color " DreamCode Install Complete" $BOLD $true
Write-Color ("=" * 50) $GREEN
Write-Color "" $MUTED

$fullPath = "$BIN_DIR\$APP.exe"
if (Test-Path $fullPath) {
  try {
    $version = & $fullPath --version 2>&1 | Out-String
    Write-Color "  Binary: $fullPath" $GREEN
    Write-Color "  Version: $($version.Trim())" $GREEN
  } catch {
    Write-Color "  Binary: $fullPath (version check failed)" $ORANGE
  }
} else {
  Write-Color "  ERROR: $fullPath not found!" $RED
}

Write-Color "" $CYAN
Write-Color "Quick start:" $CYAN
Write-Color "  Open a NEW PowerShell window (for PATH to take effect)" $CYAN
Write-Color "  cd <your-project>" $CYAN
Write-Color "  $APP" $CYAN
Write-Color "" $CYAN
Write-Color "Configuration:" $CYAN
Write-Color "  ~\.config\dreamcode\config.yaml (create if missing)" $CYAN
Write-Color "" $CYAN
Write-Color "NEURO API (Highly Recommended):" $CYAN
Write-Color "  Get your free key at https://neurometric.ai" $CYAN
Write-Color "  Then: `$env:NEURO_API_KEY = 'your-key'" $CYAN
Write-Color "" $MUTED
Write-Color "Docs: https://github.com/weebcoder101/dreamcode" $MUTED
