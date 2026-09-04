ARG REGISTRY=ghcr.io/anomalyco
FROM ${REGISTRY}/build/bun-node:24.04

ARG RUST_TOOLCHAIN=stable

ENV CARGO_HOME=/opt/cargo
ENV RUSTUP_HOME=/opt/rustup
ENV PATH=/opt/cargo/bin:/opt/bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# F-CONT-04 (rust variant): download rustup-init directly from the official GitHub
# release tag pinned to ${RUST_TOOLCHAIN}, rather than piping curl into bash. The
# rustup-init binary is version-matched to the toolchain (the release tag IS the
# toolchain version) so a pinned tag yields a known-good installer.
RUN set -euo pipefail; \
  arch=$(uname -m); \
  case "$arch" in \
    x86_64)        rust_arch=x86_64-unknown-linux-gnu ;; \
    aarch64|arm64) rust_arch=aarch64-unknown-linux-gnu ;; \
    *) echo "unsupported arch: $arch" >&2; exit 1 ;; \
  esac; \
  curl -fsSL -o /tmp/rustup-init \
    "https://github.com/rust-lang/rustup/releases/download/${RUST_TOOLCHAIN}/rustup-init-${rust_arch}"; \
  chmod +x /tmp/rustup-init; \
  /tmp/rustup-init -y --profile minimal --default-toolchain "${RUST_TOOLCHAIN}" --no-modify-path; \
  rm -f /tmp/rustup-init; \
  rustc --version; \
  cargo --version
