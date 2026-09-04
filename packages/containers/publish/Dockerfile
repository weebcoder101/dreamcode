ARG REGISTRY=ghcr.io/anomalyco
FROM ${REGISTRY}/build/bun-node:24.04

ARG DEBIAN_FRONTEND=noninteractive

# SECURITY: docker.io + pacman-package-manager are build-time tools
# only. They are not used at runtime. If a maintainer rewrites this
# image to a runtime-only purpose, drop both packages and add a
# non-root USER. See wave5-retry F-CONT-01.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    docker.io \
    pacman-package-manager \
  && rm -rf /var/lib/apt/lists/*
