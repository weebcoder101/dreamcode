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

# Force TLS 1.2 (GitHub requires it; older Windows defaults to TLS 1.0)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$APP = "dreamcode"
$OWNER = "weebcoder101"
$REPO = "dreamcode"
$INSTALL_DIR = if ($env:DREAMCODE_DIR) { $env:DREAMCODE_DIR } else { "$env:USERPROFILE\.dreamcode" }
$BIN_DIR = "$env:LOCALAPPDATA\$APP\bin"
$tempDir = "$env:TEMP\dreamcode-install"

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
  Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
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

    # Find the windows-x64 asset (build system produces .zip for Windows)
    $assetName = "dreamcode-windows-x64.zip"
    $downloadUrl = "https://github.com/$OWNER/$REPO/releases/download/$tag/$assetName"
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
  } catch {
    Write-Color "ERROR: Failed to fetch latest release from GitHub API." $RED
    Write-Color "Falling back to source build (requires git + bun)..." $ORANGE
    $BuildFromSource = $true
  }
}

# ─── Phase 1b: Extract pre-built binary ───────────────────────────────
if (-not $BuildFromSource -and (Test-Path $tempArchive)) {
  Write-Color "Extracting..." $CYAN

  # Use native PowerShell Expand-Archive (works on all Windows versions)
  try {
    Expand-Archive -Path $tempArchive -DestinationPath $extractDir -Force
  } catch {
    Write-Color "WARN: Extraction failed — falling back to source build: $_" $ORANGE
    $BuildFromSource = $true
  }

  if (-not $BuildFromSource) {
    $binaryPath = Get-ChildItem -Recurse -Filter "dreamcode.exe" -Path $extractDir | Select-Object -First 1
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
}

# ─── Phase 1c: Build from source (fallback or explicit) ───────────────
if ($BuildFromSource) {
  Write-Color "Building from source..." $CYAN

  # Check for git before attempting source build
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Color "ERROR: git is required for source build but was not found." $RED
    Write-Color "Install git from https://git-scm.com/download/win and re-run." $ORANGE
    exit 1
  }

  # Clone or update repo
  if (Test-Path "$INSTALL_DIR\.git") {
    Write-Color "Updating existing DreamCode install..." $CYAN
    git -C $INSTALL_DIR pull 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Color "WARN: git pull failed (detached HEAD or network issue). Using working tree as-is." $ORANGE
      git -C $INSTALL_DIR checkout .
    }
  } else {
    if (Test-Path $INSTALL_DIR) {
      Write-Color "ERROR: $INSTALL_DIR exists but is not a git repo." $RED
      Write-Color "Remove it or set `$env:DREAMCODE_DIR to a different path." $ORANGE
      exit 1
    }
    Write-Color "Cloning DreamCode..." $CYAN
    try {
      git clone "https://github.com/$OWNER/$REPO.git" $INSTALL_DIR
    } catch {
      Write-Color "ERROR: git clone failed: $_" $RED
      exit 1
    }
  }

  # Check for bun
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Color "Installing bun..." $CYAN
    # Use bun's official PowerShell installer (scope ErrorActionPreference to avoid breaking it)
    $bunInstallScript = Invoke-RestMethod -Uri "https://bun.sh/install.ps1"
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      Invoke-Expression ($bunInstallScript)
    } finally {
      $ErrorActionPreference = $prevEAP
    }
    $env:Path = "$env:USERPROFILE\.bun\bin;$env:Path"
  }

  # Read version from package.json
  $pkg = Get-Content "$INSTALL_DIR\packages\opencode\package.json" | ConvertFrom-Json
  $VERSION = $pkg.version
  $env:OPENCODE_VERSION = $VERSION
  Write-Color "Building version: $VERSION" $MUTED

  Set-Location $INSTALL_DIR
  # Windows requires --linker hoisted for symlink compatibility (bun#12385)
  $bunInstallArgs = @("install")
  if ($env:OS -eq "Windows_NT") { $bunInstallArgs += "--linker", "hoisted" }

  $sourceBuildOk = $true
  try {
    & "bun" @bunInstallArgs
  } catch {
    Write-Color "WARN: bun install failed (likely native dep compilation on Windows): $_" $ORANGE
    Write-Color "Continuing — the pre-built download path is the primary install method for Windows." $ORANGE
    $sourceBuildOk = $false
  }

  if ($sourceBuildOk) {
    Set-Location packages\opencode

    $buildOk = $true
    try {
      bun run build --single --skip-embed-web-ui --skip-install
    } catch {
      Write-Color "WARN: bun build failed (likely bun 1.3.x Schema AST bug on Windows): $_" $ORANGE
      $buildOk = $false
    }

    if ($buildOk) {
      # Verify binary
      $NATIVE_BIN = "dist\dreamcode-windows-x64\bin\dreamcode.exe"
      if (Test-Path $NATIVE_BIN) {
        # Copy binary
        New-Item -ItemType Directory -Force -Path $BIN_DIR | Out-Null
        Copy-Item $NATIVE_BIN "$BIN_DIR\$APP.exe" -Force
        Write-Color "Installed $APP.exe to $BIN_DIR" $GREEN
      } else {
        Write-Color "WARN: Build did not produce expected binary at $NATIVE_BIN" $ORANGE
      }
    }
  }

  if (-not (Test-Path "$BIN_DIR\$APP.exe")) {
    Write-Color "WARN: Binary was not installed via source build. The pre-built download path is recommended for Windows." $ORANGE
    Write-Color "Install with: .\install.ps1 (without -BuildFromSource) to download a pre-built binary." $CYAN
  }
}

# ─── Phase 1d: Install Python scripts to skills directory ─────────────
# The Python scripts (sensor_gate.py, neuro_harness.py, etc.) are needed
# for persona/skill/chain functionality. The resolver checks
# %USERPROFILE%\.dreamcode\skills (among others) at runtime.
$SKILLS_DST = "$env:USERPROFILE\.dreamcode\skills"

# Source candidates:
#   1. Bundled alongside the binary in the extracted archive (pre-built)
#   2. Source repo path (BuildFromSource)
# Search recursively for skills directory (same pattern as binary search)
$skillsDir = Get-ChildItem -Recurse -Directory -Filter "skills" -Path $extractDir | Where-Object {
  # Must contain chain-orchestrator (the key skill with sensor_gate.py)
  $_.GetFiles("*.py", [System.IO.SearchOption]::AllDirectories).Count -gt 0
} | Select-Object -First 1

$repoSkills = "$INSTALL_DIR\packages\opencode\src\skill\dreamcode\skills"
$skillsSource = $null

if (-not $BuildFromSource -and $skillsDir) {
  $skillsSource = $skillsDir.FullName
  Write-Color "Found bundled skills in release archive at $skillsSource" $MUTED
} elseif ($BuildFromSource -and (Test-Path $repoSkills)) {
  $skillsSource = $repoSkills
  Write-Color "Found skills in source repo." $MUTED
}

if ($skillsSource) {
  Write-Color "Installing Python scripts to skills directory..." $CYAN
  try {
    # Create destination if it doesn't exist
    New-Item -ItemType Directory -Force -Path $SKILLS_DST | Out-Null
    
    # Copy all skill directories recursively
    Copy-Item -Path "$skillsSource\*" -Destination $SKILLS_DST -Recurse -Force
    
    # Count installed scripts
    $scriptCount = (Get-ChildItem -Path $SKILLS_DST -Filter "*.py" -Recurse).Count
    Write-Color "Installed $scriptCount Python scripts to $SKILLS_DST" $GREEN
    
    # Also install alongside the binary so runtime resolver finds them
    # via dirname(process.execPath) + "/skills"
    $binSkillsDir = "$BIN_DIR\skills"
    New-Item -ItemType Directory -Force -Path $binSkillsDir | Out-Null
    Copy-Item -Path "$skillsSource\*" -Destination $binSkillsDir -Recurse -Force
    Write-Color "Also installed skills to $binSkillsDir (for runtime resolution)" $MUTED
  } catch {
    Write-Color "WARN: Failed to install Python scripts: $_" $ORANGE
    Write-Color "Personas and skill chains may not work without Python scripts." $ORANGE
  }
} else {
  Write-Color "WARN: No Python skills source found." $ORANGE
  Write-Color "If using a pre-built release, the skills should be bundled in the archive." $ORANGE
  Write-Color "If building from source, ensure the repo is complete." $ORANGE
  Write-Color "Personas and skill chains will be disabled without Python scripts." $ORANGE
  Write-Color "To fix:" $ORANGE
  Write-Color "  Option A: Re-run with -BuildFromSource from a full repo clone:" $CYAN
  Write-Color "    .\install.ps1 -BuildFromSource" $CYAN
  Write-Color "  Option B: Set DREAMCODE_DIR to your repo root AND use -BuildFromSource:" $CYAN
  Write-Color "    `$env:DREAMCODE_DIR = 'C:\path\to\dreamcode'; .\install.ps1 -BuildFromSource" $CYAN
  Write-Color "  Option C: Manually copy skills from the extracted archive:" $CYAN
  Write-Color "    Copy-Item -Path (Get-ChildItem -Recurse -Directory -Filter skills -Path ""$extractDir"" | Select-Object -First 1).FullName -Destination ""$SKILLS_DST"" -Recurse -Force" $CYAN
}

# ─── Phase 1e: Verify Python availability ─────────────────────────────
# Check if Python is available on the system
$pythonAvailable = $false
$pythonCmd = $null

# Try py -3 (Python Launcher for Windows)
if (Get-Command py -ErrorAction SilentlyContinue) {
  try {
    $pyVersion = & py -3 --version 2>&1 | Out-String
    if ($pyVersion -match "Python 3") {
      $pythonAvailable = $true
      $pythonCmd = "py -3"
      Write-Color "Python 3 found via Python Launcher: $pythonCmd" $GREEN
    }
  } catch {}
}

# Try python
if (-not $pythonAvailable -and (Get-Command python -ErrorAction SilentlyContinue)) {
  try {
    $pyVersion = & python --version 2>&1 | Out-String
    if ($pyVersion -match "Python 3") {
      $pythonAvailable = $true
      $pythonCmd = "python"
      Write-Color "Python 3 found: $pythonCmd" $GREEN
    }
  } catch {}
}

# Try python3
if (-not $pythonAvailable -and (Get-Command python3 -ErrorAction SilentlyContinue)) {
  try {
    $pyVersion = & python3 --version 2>&1 | Out-String
    if ($pyVersion -match "Python 3") {
      $pythonAvailable = $true
      $pythonCmd = "python3"
      Write-Color "Python 3 found: $pythonCmd" $GREEN
    }
  } catch {}
}

if (-not $pythonAvailable) {
  Write-Color "" $ORANGE
  Write-Color "WARNING: Python 3 not found on your system!" $RED
  Write-Color "The persona/skill/chain features require Python 3." $ORANGE
  Write-Color "" $ORANGE
  Write-Color "To install Python 3 on Windows:" $CYAN
  Write-Color "  1. Download from https://www.python.org/downloads/" $CYAN
  Write-Color "  2. Run the installer" $CYAN
  Write-Color "  3. CHECK THE BOX: 'Add Python to PATH'" $CYAN
  Write-Color "  4. Restart your terminal" $CYAN
  Write-Color "" $ORANGE
  Write-Color "Or install via winget:" $CYAN
  Write-Color "  winget install Python.Python.3.12" $CYAN
  Write-Color "" $ORANGE
  Write-Color "Without Python, you can still use DreamCode for basic tasks." $MUTED
  Write-Color "Personas and skill chains will be disabled." $MUTED
} else {
  Write-Color "" $MUTED
  Write-Color "Python 3 verified: $pythonCmd" $GREEN
}

# ─── Phase 2: Add to user PATH (only if binary was installed) ──────────
$installSucceeded = Test-Path "$BIN_DIR\$APP.exe"
if ($installSucceeded) {
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($userPath -notlike "*$BIN_DIR*") {
    [Environment]::SetEnvironmentVariable("Path", "$BIN_DIR;$userPath", "User")
    # Also update current session
    $env:Path = "$BIN_DIR;$env:Path"
    Write-Color "Added $BIN_DIR to user PATH" $GREEN
    # Support CI (GitHub Actions): propagate PATH to subsequent steps
    if ($env:GITHUB_PATH) {
      Add-Content -Path $env:GITHUB_PATH -Value $BIN_DIR
    }
  } else {
    Write-Color "$BIN_DIR already in PATH" $MUTED
  }
} else {
  Write-Color "Installation did not complete — PATH not modified." $ORANGE
}

# ─── Cleanup: remove temp directory ──────────────────────────────────
if (Test-Path $tempDir) {
  Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
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

# Verify skills installation
$skillsInstalled = Test-Path "$SKILLS_DST\chain-orchestrator\scripts\sensor_gate.py"
if ($skillsInstalled) {
  Write-Color "  Skills: $SKILLS_DST (installed)" $GREEN
} else {
  Write-Color "  Skills: $SKILLS_DST (not found)" $ORANGE
}

# Verify Python
if ($pythonAvailable) {
  Write-Color "  Python: $pythonCmd (available)" $GREEN
} else {
  Write-Color "  Python: NOT FOUND (personas disabled)" $RED
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
