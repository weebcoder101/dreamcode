#!/usr/bin/env bash
set -euo pipefail
APP=dreamcode

MUTED='\033[0;2m'
RED='\033[0;31m'
ORANGE='\033[38;5;214m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Sandbox opt-in ─────────────────────────────────────────
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

# ─── System deps ────────────────────────────────────────────
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

# ─── Firejail (only if sandbox requested) ───────────────────
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

# ─── Bun ────────────────────────────────────────────────────
if ! command -v bun &> /dev/null; then
  echo -e "${CYAN}Installing bun...${NC}"
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

# ─── Clone or update ────────────────────────────────────────
INSTALL_DIR="${DREAMCODE_DIR:-$HOME/.dreamcode}"
if [ -d "$INSTALL_DIR/.git" ]; then
  echo -e "${CYAN}Updating existing DreamCode install...${NC}"
  cd "$INSTALL_DIR" && git pull origin main 2>/dev/null || git pull origin dreamcode-fork
else
  echo -e "${CYAN}Cloning DreamCode...${NC}"
  git clone https://github.com/weebcoder101/dreamcode.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ─── Install + build ────────────────────────────────────────
echo -e "${CYAN}Installing dependencies...${NC}"
bun install

echo -e "${CYAN}Installing Python dependencies for skill scripts...${NC}"
if [ -f "$INSTALL_DIR/.dreamcode/requirements.txt" ]; then
  pip3 install -r "$INSTALL_DIR/.dreamcode/requirements.txt" 2>/dev/null || echo -e "${ORANGE}WARN: pip install failed, some skills may not work${NC}"
fi

echo -e "${CYAN}Building...${NC}"
cd packages/opencode
bun run build 2>/dev/null || echo -e "${ORANGE}WARN: Build script not found, skipping${NC}"

# ─── Create binary symlink ──────────────────────────────────
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
esac
NATIVE_BIN="dist/opencode-${PLATFORM}-${ARCH}/bin/opencode"
if [ -f "$NATIVE_BIN" ]; then
  ln -sf "../dist/opencode-${PLATFORM}-${ARCH}/bin/opencode" "$(pwd)/bin/opencode"
  echo -e "${GREEN}Linked native binary: ${PLATFORM}-${ARCH}${NC}"
fi

# ─── Global binary ──────────────────────────────────────────
echo -e "${CYAN}Installing dreamcode binary globally...${NC}"
npm install -g . 2>/dev/null || echo -e "${ORANGE}WARN: npm install -g failed, you may need to run manually${NC}"

# ─── PATH ───────────────────────────────────────────────────
INSTALL_BIN="$HOME/.bun/bin"
if [[ ":$PATH:" != *":$INSTALL_BIN:"* ]]; then
  export PATH="$INSTALL_BIN:$PATH"
  SHELL_RC=""
  case "$(basename "$SHELL")" in
    zsh)  SHELL_RC="$HOME/.zshrc" ;;
    bash) SHELL_RC="$HOME/.bashrc" ;;
    fish) SHELL_RC="$HOME/.config/fish/config.fish" ;;
  esac
  if [[ -n "$SHELL_RC" ]] && [[ -f "$SHELL_RC" ]]; then
    if ! grep -q "$INSTALL_BIN" "$SHELL_RC" 2>/dev/null; then
      echo "export PATH=\"$INSTALL_BIN:\$PATH\"" >> "$SHELL_RC"
      echo -e "${GREEN}Added $INSTALL_BIN to $SHELL_RC${NC}"
    fi
  fi
fi

# ─── Config dir ─────────────────────────────────────────────
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

# ─── DreamCode directories ──────────────────────────────────
mkdir -p "$INSTALL_DIR/skills" "$INSTALL_DIR/config" "$INSTALL_DIR/scripts" "$INSTALL_DIR/automations" "$INSTALL_DIR/automations/prompts"
echo -e "${GREEN}Created dreamcode directories at $INSTALL_DIR${NC}"

# ─── Install skills to global config (so they work from ANY directory) ──
CONFIG_SKILLS="$HOME/.config/dreamcode/skills"
REPO_SKILLS="$INSTALL_DIR/.dreamcode/skills"
REPO_SKILLS_ALT="$INSTALL_DIR/.opencode/skills"
mkdir -p "$CONFIG_SKILLS"
if [ -d "$REPO_SKILLS" ]; then
  cp -r "$REPO_SKILLS/"* "$CONFIG_SKILLS/" 2>/dev/null || true
  echo -e "${GREEN}Installed $(ls "$REPO_SKILLS" 2>/dev/null | wc -l) skills to $CONFIG_SKILLS${NC}"
elif [ -d "$REPO_SKILLS_ALT" ]; then
  cp -r "$REPO_SKILLS_ALT/"* "$CONFIG_SKILLS/" 2>/dev/null || true
  echo -e "${GREEN}Installed $(ls "$REPO_SKILLS_ALT" 2>/dev/null | wc -l) skills to $CONFIG_SKILLS${NC}"
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

# ─── Verify ─────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC}  ${BOLD}DreamCode Install Complete${NC}              ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""

if command -v dreamcode &> /dev/null; then
  echo -e "  ${GREEN}✓${NC} dreamcode binary: $(which dreamcode)"
  echo -e "  ${GREEN}✓${NC} version: $(dreamcode --version 2>/dev/null || echo 'run dreamcode --version')"
else
  echo -e "  ${ORANGE}!${NC} dreamcode binary not found in PATH"
  echo -e "  ${MUTED}  Try: export PATH=\"\$HOME/.bun/bin:\$PATH\"${NC}"
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
