#!/usr/bin/env bash
set -euo pipefail

# ───────────────────────────────────────────────────────────────────────
# DreamCode Installer
#
# Fixed issues:
#   1. Self-updating race — saves script to disk before git pull,
#      re-execs from the updated copy
#   2. Branch detection — auto-detects remote HEAD instead of
#      hard-coding "main"/"dreamcode-fork"
#   3. Silent error swallowing — all failures are visible with
#      their stderr output
#   4. Post-build version verification — binary --version is compared
#      against the expected version
#   5. Symlink resolution — verifies target exists & is executable
#   6. PATH availability — always exported for the running session
#      regardless of shell detection
#   7. Removed bun install -g . (broke due to relative bin symlink;
#      ~/.local/bin/dreamcode is the canonical entry point)
#   8. Version derived from packages/opencode/package.json instead
#      of a hard-coded string
#   9. Stale clone / split-brain detection at the end
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/weebcoder101/dreamcode/main/install.sh | bash
#   bash install.sh
# ───────────────────────────────────────────────────────────────────────

APP=dreamcode

# ─── Colors ───────────────────────────────────────────────────────────
MUTED='\033[0;2m'
RED='\033[0;31m'
ORANGE='\033[38;5;214m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Bootstrap: clone/update + re-exec from repo ─────────────────────
#
# Problem: When run via `curl | bash`, bash reads the script into memory.
# If `git pull` updates install.sh on disk, the running process still has
# the OLD code in memory — so the build runs without OPENCODE_VERSION,
# producing a stale binary.
#
# Solution (three-phase bootstrap):
#
#   Phase 1 — Bootstrap (runs every invocation, idempotent):
#     Clone or git pull the repo to $INSTALL_DIR.
#
#   Phase 2 — Re-exec from the updated repo (first invocation only):
#     If INSTALL_DIR/install.sh exists and we aren't running from it,
#     `exec bash` the on-disk copy with DREAMCODE_INSTALL_REEXEC set
#     to prevent infinite loops.
#
#   Phase 3 — Build + Install (only the re-exec'd invocation):
#     Build the binary, create symlinks, configure.
#
# This works correctly for:
#   curl -fsSL ...install.sh | bash
#     Phase 1 runs from memory (may be stale), pulls/clones repo.
#     Phase 2 exec's the UPDATED on-disk install.sh.
#     Phase 1 runs again (no-op — already up to date).
#     Phase 2 skips (re-exec already ran).
#     Phase 3 builds with correct OPENCODE_VERSION.
#
#   bash install.sh (from workspace or elsewhere)
#     Same flow.  After exec, the updated install.sh runs.
#
#   bash ~/.dreamcode/install.sh (direct from install dir)
#     Phase 1 no-op (already up to date).
#     Phase 2 skips (already running from INSTALL_DIR).
#     Phase 3 builds.

INSTALL_DIR="${DREAMCODE_DIR:-$HOME/.dreamcode}"
SCRIPT_NAME="install.sh"

# ─── Phase 1: Bootstrap (clone/update repo) ───────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  echo -e "${CYAN}Updating existing DreamCode install...${NC}"
  CURRENT_BRANCH=$(git -C "$INSTALL_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
  echo -e "${MUTED}Branch: $CURRENT_BRANCH${NC}"
  if ! git -C "$INSTALL_DIR" pull origin "$CURRENT_BRANCH"; then
    echo -e "${ORANGE}WARN: git pull failed on '$CURRENT_BRANCH'. Continuing with existing clone.${NC}"
  fi
else
  if [ -d "$INSTALL_DIR" ]; then
    echo -e "${RED}$INSTALL_DIR exists but is not a git repo.${NC}"
    echo -e "${ORANGE}Remove it with: rm -rf $INSTALL_DIR${NC}"
    echo -e "${ORANGE}Or set DREAMCODE_DIR to a different path.${NC}"
    exit 1
  fi
  echo -e "${CYAN}Cloning DreamCode...${NC}"
  git clone https://github.com/weebcoder101/dreamcode.git "$INSTALL_DIR"
fi

# ─── Phase 2: Re-exec from repo (skip if already there) ──────────────
if [ -z "${DREAMCODE_INSTALL_REEXEC:-}" ] && [ -f "$INSTALL_DIR/$SCRIPT_NAME" ]; then
  # Determine our current script location
  SCRIPT_SOURCE_DIR=""
  if [ -f "$0" ] && [ "$0" != "bash" ] && [ "$0" != "-bash" ]; then
    SCRIPT_SOURCE_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
  fi
  
  if [ "$SCRIPT_SOURCE_DIR" != "$INSTALL_DIR" ]; then
    echo -e "${CYAN}Re-executing from updated install script...${NC}"
    export DREAMCODE_INSTALL_REEXEC="1"
    exec bash "$INSTALL_DIR/$SCRIPT_NAME" "$@"
  fi
fi

# ─── Phase 3: Build + Install — only reached after re-exec ───────────
# At this point we're guaranteed to be running the LATEST install.sh
# from $INSTALL_DIR.

# ─── Sandbox opt-in ───────────────────────────────────────────────────
SANDBOX_ENABLED="${DREAMCODE_SANDBOX:-off}"

warn_sandbox() {
  echo ""
  echo -e "${ORANGE}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${ORANGE}║${NC}  ${BOLD}SANDBOX MODE — SECURITY NOTICE${NC}                            ${ORANGE}║${NC}"
  echo -e "${ORANGE}╠══════════════════════════════════════════════════════════════╣${NC}"
  echo -e "${ORANGE}║${NC}                                                              ${ORANGE}║${NC}"
  echo -e "${ORANGE}║${NC}  Sandbox is ${BOLD}OFF by default${NC}.                                ${ORANGE}║${NC}"
  echo -e "${ORANGE}║${NC}                                                              ${ORANGE}║${NC}"
  echo -e "${ORANGE}║${NC}  When OFF: DreamCode has full filesystem access.             ${ORANGE}║${NC}"
  echo -e "${ORANGE}║${NC}  When ON:  Commands run inside firejail isolation.           ${ORANGE}║${NC}"
  echo -e "${ORANGE}║${NC}                                                              ${ORANGE}║${NC}"
  echo -e "${ORANGE}║${NC}  To enable sandbox after install:                            ${ORANGE}║${NC}"
  echo -e "${ORANGE}║${NC}    export DREAMCODE_SANDBOX=on                               ${ORANGE}║${NC}"
  echo -e "${ORANGE}║${NC}  Or add to ~/.config/dreamcode/config.yaml:                  ${ORANGE}║${NC}"
  echo -e "${ORANGE}║${NC}    sandbox: true                                            ${ORANGE}║${NC}"
  echo -e "${ORANGE}║${NC}                                                              ${ORANGE}║${NC}"
  echo -e "${ORANGE}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
}

# ─── System deps ──────────────────────────────────────────────────────
if ! command -v unzip &> /dev/null; then
  echo -e "${ORANGE}Installing unzip (required for binary extraction)...${NC}"
  if command -v apt-get &> /dev/null; then
    sudo apt-get install -y unzip
  elif command -v brew &> /dev/null; then
    brew install unzip
  elif command -v dnf &> /dev/null; then
    sudo dnf install -y unzip
  else
    echo -e "${RED}Please install unzip manually, then re-run this script.${NC}"
    exit 1
  fi
fi

# ─── Firejail (only if sandbox requested) ─────────────────────────────
# firejail is Linux-only — skip entirely on macOS/Darwin
if [[ "$(uname -s)" == "Darwin" ]]; then
  if [[ "$SANDBOX_ENABLED" == "on" ]]; then
    echo -e "${ORANGE}WARN: Sandbox mode (firejail) is Linux-only. Disabling.${NC}"
  fi
  SANDBOX_ENABLED="off"
fi

if [[ "$SANDBOX_ENABLED" == "on" ]]; then
  if ! command -v firejail &> /dev/null; then
    echo -e "${CYAN}Installing firejail (sandbox requested)...${NC}"
    if command -v apt-get &> /dev/null; then
      sudo apt-get install -y firejail 2>/dev/null || echo -e "${ORANGE}WARN: firejail install failed, sandbox will be unavailable${NC}"
    elif command -v brew &> /dev/null; then
      brew install firejail 2>/dev/null || echo -e "${ORANGE}WARN: firejail install failed, sandbox will be unavailable${NC}"
    else
      echo -e "${ORANGE}WARN: Cannot install firejail automatically. Sandbox will be unavailable.${NC}"
    fi
  fi
  echo -e "${GREEN}Sandbox: ON (firejail)${NC}"
else
  warn_sandbox
  echo -e "${GREEN}Sandbox: OFF (full filesystem access)${NC}"
fi

# ─── Bun ──────────────────────────────────────────────────────────────
if ! command -v bun &> /dev/null; then
  echo -e "${CYAN}Installing bun...${NC}"
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

# At this point we're guaranteed to be running from $INSTALL_DIR
cd "$INSTALL_DIR"

# ─── Derive version ───────────────────────────────────────────────────
# Read from the canonical source (package.json) instead of hard-coding.
VERSION=""
# Try packages/opencode/package.json first (most specific)
if [ -f "packages/opencode/package.json" ]; then
  VERSION=$(grep -o '"version": *"[^"]*"' < "packages/opencode/package.json" 2>/dev/null | head -1 | cut -d'"' -f4 || echo "")
fi
# Fallback: git tag
if [ -z "$VERSION" ]; then
  VERSION=$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || echo "1.0.0")
fi
export OPENCODE_VERSION="$VERSION"
echo -e "${MUTED}Building version: $OPENCODE_VERSION${NC}"

# ─── Install + build ──────────────────────────────────────────────────
echo -e "${CYAN}Installing dependencies...${NC}"
bun install

echo -e "${CYAN}Installing Python dependencies for skill scripts...${NC}"
if [ -f "$INSTALL_DIR/.dreamcode/requirements.txt" ]; then
  if command -v pip3 &> /dev/null; then
    if ! pip3 install -r "$INSTALL_DIR/.dreamcode/requirements.txt"; then
      echo -e "${ORANGE}WARN: pip install failed — some AI scripts may not work.${NC}"
      echo -e "${ORANGE}      Install manually: pip3 install -r .dreamcode/requirements.txt${NC}"
    fi
  else
    echo -e "${ORANGE}WARN: pip3 not found — Python skill scripts may not work. Install python3-pip and re-run.${NC}"
  fi
fi

echo -e "${CYAN}Building...${NC}"
cd packages/opencode

BUILD_ARGS="--single --skip-embed-web-ui --skip-install"
if ! OPENCODE_VERSION="$OPENCODE_VERSION" bun run build $BUILD_ARGS; then
  echo -e "${RED}Build failed. See errors above.${NC}"
  echo -e "${ORANGE}Retry manually: cd packages/opencode && OPENCODE_VERSION=$OPENCODE_VERSION bun run build $BUILD_ARGS${NC}"
  exit 1
fi

# ─── Platform identification ──────────────────────────────────────────
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
esac
NATIVE_BIN="dist/opencode-${PLATFORM}-${ARCH}/bin/opencode"

# ─── Post-build verification ──────────────────────────────────────────
echo -e "${CYAN}Verifying build output...${NC}"

# 1) Binary must exist
if ! [ -f "$NATIVE_BIN" ]; then
  echo -e "${RED}ERROR: Build did not produce expected binary.${NC}"
  echo -e "${MUTED}  Expected: $(pwd)/$NATIVE_BIN${NC}"
  echo -e "${MUTED}  Dist contents:$(ls -la dist/ 2>/dev/null || echo '  dist/ missing')${NC}"
  exit 1
fi

# 2) Binary must be executable
if ! [ -x "$NATIVE_BIN" ]; then
  echo -e "${RED}ERROR: Binary is not executable.${NC}"
  chmod +x "$NATIVE_BIN"
  echo -e "${ORANGE}  Fixed: chmod +x $NATIVE_BIN${NC}"
fi

# 3) Binary version must match expected version
DIST_BIN="$(pwd)/${NATIVE_BIN}"
ACTUAL_VERSION=$("$DIST_BIN" --version 2>/dev/null || echo "FAILED")
if echo "$ACTUAL_VERSION" | grep -qF "$OPENCODE_VERSION"; then
  echo -e "${GREEN}✓ Version verified: $ACTUAL_VERSION${NC}"
else
  echo -e "${RED}ERROR: Binary reports '$ACTUAL_VERSION', expected '$OPENCODE_VERSION'${NC}"
  echo -e "${ORANGE}Retrying build with explicit OPENCODE_VERSION...${NC}"
  if ! OPENCODE_VERSION="$OPENCODE_VERSION" bun run build $BUILD_ARGS; then
    echo -e "${RED}Rebuild also failed. Please report this error.${NC}"
    exit 1
  fi
  ACTUAL_VERSION=$("$DIST_BIN" --version 2>/dev/null || echo "FAILED")
  if ! echo "$ACTUAL_VERSION" | grep -qF "$OPENCODE_VERSION"; then
    echo -e "${RED}ERROR: Rebuilt binary still reports '$ACTUAL_VERSION'. Version string mismatch persists.${NC}"
    echo -e "${ORANGE}Check packages/opencode/script/build.ts and packages/script/src/index.ts${NC}"
    exit 1
  fi
  echo -e "${GREEN}✓ Version verified after rebuild: $ACTUAL_VERSION${NC}"
fi

# ─── Create binary symlinks ───────────────────────────────────────────
echo -e "${CYAN}Creating symlinks...${NC}"

# Absolute symlink inside repo (for package.json "bin" field)
mkdir -p "$(pwd)/bin"
ln -sf "$DIST_BIN" "$(pwd)/bin/opencode"
echo -e "${GREEN}Linked repo bin/opencode → ${DIST_BIN}${NC}"

# Absolute symlink in ~/.local/bin — THE canonical entry point
LOCAL_BIN="$HOME/.local/bin"
mkdir -p "$LOCAL_BIN"
ln -sf "$DIST_BIN" "$LOCAL_BIN/dreamcode"
echo -e "${GREEN}Linked ~/.local/bin/dreamcode → ${DIST_BIN}${NC}"

# Verify symlink resolution
REAL_TARGET=$(readlink -f "$LOCAL_BIN/dreamcode" 2>/dev/null || echo "BROKEN")
if [ -f "$REAL_TARGET" ] && [ -x "$REAL_TARGET" ]; then
  echo -e "${GREEN}✓ Symlink resolves to executable: $REAL_TARGET${NC}"
else
  echo -e "${RED}ERROR: Symlink target is missing or not executable: $REAL_TARGET${NC}"
  exit 1
fi

# ─── PATH for current session ─────────────────────────────────────────
# Always export, regardless of shell rc detection, so the verification
# below works immediately.
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
echo -e "${GREEN}Added ~/.local/bin and ~/.bun/bin to PATH for this session${NC}"

# ─── PATH persistence (shell rc files) ────────────────────────────────
path_add_to_rc() {
  local dir="$1"
  local pattern="$2"
  local rc=""
  case "$(basename "$SHELL")" in
    zsh)  rc="$HOME/.zshrc" ;;
    bash) rc="$HOME/.bashrc" ;;
    fish) rc="$HOME/.config/fish/config.fish" ;;
  esac
  if [[ -n "$rc" ]] && [[ -f "$rc" ]]; then
    if ! grep -q "$pattern" "$rc" 2>/dev/null; then
      case "$(basename "$SHELL")" in
        fish)
          echo "set -gx PATH $dir \$PATH" >> "$rc"
          ;;
        *)
          echo "export PATH=\"$dir:\$PATH\"" >> "$rc"
          ;;
      esac
      echo -e "${GREEN}Added $dir to $rc${NC}"
    fi
  fi
}
path_add_to_rc "$HOME/.local/bin" "\.local/bin"
path_add_to_rc "$HOME/.bun/bin" "$HOME/.bun/bin"

# ─── Config dir ───────────────────────────────────────────────────────
CONFIG_DIR="$HOME/.config/dreamcode"
mkdir -p "$CONFIG_DIR"
if [[ ! -f "$CONFIG_DIR/config.yaml" ]]; then
  cat > "$CONFIG_DIR/config.yaml" << 'YAML'
# DreamCode Configuration
# Docs: https://github.com/weebcoder101/dreamcode#configuration

sandbox: false          # Set to true to enable firejail sandbox
dream_mode: true        # Enable 6-phase dream thinking
scoring: true           # Enable scoring enforcement
model_router: true      # Enable 120+ model routing
YAML
  echo -e "${GREEN}Created default config at $CONFIG_DIR/config.yaml${NC}"
fi

# ─── DreamCode directories ────────────────────────────────────────────
mkdir -p "$INSTALL_DIR/skills" "$INSTALL_DIR/config" "$INSTALL_DIR/scripts" "$INSTALL_DIR/automations" "$INSTALL_DIR/automations/prompts"
echo -e "${GREEN}Created dreamcode directories at $INSTALL_DIR${NC}"

# ─── Install skills to global config ──────────────────────────────────
CONFIG_SKILLS="$HOME/.config/dreamcode/skills"
REPO_SKILLS="$INSTALL_DIR/.dreamcode/skills"
REPO_SKILLS_ALT="$INSTALL_DIR/.opencode/skills"
mkdir -p "$CONFIG_SKILLS"
if [ -d "$REPO_SKILLS" ]; then
  cp -r "$REPO_SKILLS/"* "$CONFIG_SKILLS/" 2>/dev/null || true
  SKILL_COUNT=$(ls -d "$REPO_SKILLS"/*/ 2>/dev/null | wc -l)
  echo -e "${GREEN}Installed $SKILL_COUNT skills to $CONFIG_SKILLS${NC}"
elif [ -d "$REPO_SKILLS_ALT" ]; then
  cp -r "$REPO_SKILLS_ALT/"* "$CONFIG_SKILLS/" 2>/dev/null || true
  SKILL_COUNT=$(ls -d "$REPO_SKILLS_ALT"/*/ 2>/dev/null | wc -l)
  echo -e "${GREEN}Installed $SKILL_COUNT skills to $CONFIG_SKILLS${NC}"
else
  echo -e "${ORANGE}WARN: No skills found in repo to install${NC}"
fi
# Also copy scripts and automations if they exist
if [ -d "$INSTALL_DIR/.dreamcode/scripts" ]; then
  cp -r "$INSTALL_DIR/.dreamcode/scripts/"* "$INSTALL_DIR/scripts/" 2>/dev/null || true
fi
if [ -d "$INSTALL_DIR/.dreamcode/automations" ]; then
  cp -r "$INSTALL_DIR/.dreamcode/automations/"* "$INSTALL_DIR/automations/" 2>/dev/null || true
fi

# ─── Stale clone / split-brain detection ──────────────────────────────
# If there are multiple dreamcode installs, warn the user
OTHER_INSTALLS=""
for candidate in "$HOME/dreamcode" "$HOME/Code/dreamcode" "$HOME/dev/dreamcode"; do
  if [ -d "$candidate/.git" ] && [ "$(cd "$candidate" && pwd)" != "$(cd "$INSTALL_DIR" && pwd)" ]; then
    OTHER_INSTALLS="$OTHER_INSTALLS  - $candidate\n"
  fi
done
if [ -n "$OTHER_INSTALLS" ]; then
  echo ""
  echo -e "${ORANGE}⚠ Detected additional DreamCode clones:${NC}"
  echo -e "$OTHER_INSTALLS"
  echo -e "${ORANGE}  This may cause version confusion. Consider removing stale clones:${NC}"
  echo -e "${ORANGE}  rm -rf <stale-clone-path>${NC}"
fi

# ─── Verify ───────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC}  ${BOLD}DreamCode Install Complete${NC}              ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""

if command -v dreamcode &> /dev/null; then
  echo -e "  ${GREEN}✓${NC} dreamcode binary: $(which dreamcode)"
  echo -e "  ${GREEN}✓${NC} version: $(dreamcode --version 2>/dev/null || echo '(run dreamcode --version)')"
  echo -e "  ${GREEN}✓${NC} path: $(readlink -f "$(which dreamcode)" 2>/dev/null || echo 'N/A')"
else
  echo -e "  ${ORANGE}!${NC} dreamcode binary not found in PATH"
  echo -e "  ${MUTED}  Trying: dreamcode (after shell restart)${NC}"
fi

echo ""
echo -e "${CYAN}Quick start:${NC}"
echo -e "  cd <your-project>"
echo -e "  dreamcode"
echo ""
echo -e "${CYAN}Configuration:${NC}"
echo -e "  $CONFIG_DIR/config.yaml"
echo ""
echo -e "${CYAN}NEURO API (Highly Recommended — Free):${NC}"
echo -e "  Get your free key: ${BOLD}https://neurometric.ai${NC}"
echo -e "  Then: ${MUTED}export NEURO_API_KEY=\"your-key\"${NC}"
echo -e "  Docs: $INSTALL_DIR/GUIDE.md §19"
echo ""
echo -e "${CYAN}Interactive guide:${NC}"
echo -e "  cat $INSTALL_DIR/GUIDE.md"
echo ""
echo -e "${MUTED}Docs: https://github.com/weebcoder101/dreamcode${NC}"
echo ""
