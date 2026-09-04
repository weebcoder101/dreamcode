ARG REGISTRY=ghcr.io/anomalyco
FROM ${REGISTRY}/build/base:24.04

SHELL ["/bin/bash", "-lc"]

ARG NODE_VERSION=24.4.0
ARG BUN_VERSION=1.3.14
# F-CONT-04: pin upstream checksum file. Node.js publishes a SHASUMS256.txt at
# https://nodejs.org/dist/v${VERSION}/SHASUMS256.txt with the format
#   <sha256>  node-v${VERSION}-linux-${node_arch}.tar.xz
# and the Bun GitHub release (https://github.com/oven-sh/bun/releases/tag/bun-v${VERSION})
# publishes a sibling .sha256 file next to each binary asset. Pinning both at build time
# turns these builds into a verifiable supply chain: the tarball must match the SHA published
# by the upstream release tag, not the bytes currently served by the install script.

ENV BUN_INSTALL=/opt/bun
ENV PATH=/opt/bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Install Node.js with upstream SHA-256 verification.
RUN set -euo pipefail; \
  arch=$(uname -m); \
  case "$arch" in \
    x86_64)        node_arch=x64   bun_arch=x64   ;; \
    aarch64|arm64) node_arch=arm64 bun_arch=aarch64 ;; \
    *) echo "unsupported arch: $arch" >&2; exit 1 ;; \
  esac; \
  expected_node_sha="$(curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" \
    | awk -v v="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" '$2==v{print $1}')"; \
  if [ -z "$expected_node_sha" ]; then echo "node SHA-256 not found in upstream SHASUMS256.txt" >&2; exit 1; fi; \
  actual_node_sha="$(curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
    | tee /tmp/node.tar.xz | sha256sum | awk '{print $1}')"; \
  if [ "$expected_node_sha" != "$actual_node_sha" ]; then \
    echo "node SHA-256 mismatch: expected=$expected_node_sha actual=$actual_node_sha" >&2; exit 1; \
  fi; \
  tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1; \
  rm -f /tmp/node.tar.xz; \
  corepack enable

# Install Bun with upstream SHA-256 verification (downloads from GitHub release tag,
# not from bun.sh/install). The release tag assets include a sibling .sha256 file.
RUN set -euo pipefail; \
  arch=$(uname -m); \
  case "$arch" in \
    x86_64)        bun_arch=x64 ;; \
    aarch64|arm64) bun_arch=aarch64 ;; \
    *) echo "unsupported arch: $arch" >&2; exit 1 ;; \
  esac; \
  bun_target="bun-linux-${bun_arch}"; \
  curl -fsSL -o /tmp/bun.zip \
    "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${bun_target}.zip" && \
  curl -fsSL -o /tmp/bun.zip.sha256 \
    "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${bun_target}.zip.sha256" && \
  expected_bun_sha="$(awk '{print $1}' /tmp/bun.zip.sha256)"; \
  actual_bun_sha="$(sha256sum /tmp/bun.zip | awk '{print $1}')"; \
  if [ "$expected_bun_sha" != "$actual_bun_sha" ]; then \
    echo "bun SHA-256 mismatch: expected=$expected_bun_sha actual=$actual_bun_sha" >&2; exit 1; \
  fi; \
  mkdir -p "$BUN_INSTALL" && unzip -q /tmp/bun.zip -d "$BUN_INSTALL"; \
  rm -f /tmp/bun.zip /tmp/bun.zip.sha256; \
  bun --version; \
  node --version; \
  npm --version
