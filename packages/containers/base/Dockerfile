FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    git \
    jq \
    openssh-client \
    pkg-config \
    python3 \
    unzip \
    xz-utils \
    zip \
  && rm -rf /var/lib/apt/lists/*


# SECURITY: non-root build user (uid 10001) so derived images do not
# default to root, plus an opt-in HEALTHCHECK marker. See wave5-retry
# F-CONT-02 (no USER, no HEALTHCHECK).
RUN groupadd -g 10001 build && useradd -m -u 10001 -g build build
HEALTHCHECK NONE
