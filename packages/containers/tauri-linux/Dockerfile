ARG REGISTRY=ghcr.io/anomalyco
FROM ${REGISTRY}/build/rust:24.04

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libappindicator3-dev \
    libwebkit2gtk-4.1-dev \
    librsvg2-dev \
    patchelf \
  && rm -rf /var/lib/apt/lists/*

# SECURITY: non-root tauri user (uid 10001) so the build never runs
# as root. The parent rust image already provides /opt/cargo and
# /opt/rustup. See wave5-retry F-CONT-05.
RUN groupadd -g 10001 tauri && useradd -m -u 10001 -g tauri tauri \
  && chown -R tauri:tauri /opt/cargo /opt/rustup
USER tauri
