# Builds this fork from source (webapp + server) into a runnable image.
# Build from the repo root:  docker build -t mattermost-dopgun .
# Upstream's server/build/Dockerfile downloads a release tarball instead; this one compiles ours.

# ---- Webapp ----
FROM node:24.11.1-bookworm AS webapp
WORKDIR /src/webapp
COPY webapp/ ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev \
 && npm run build

# ---- Server + packaging ----
FROM golang:1.26.10-bookworm AS server
ARG TARGETARCH
# The Makefile reads the hash from git, but .git is not in the build context.
ARG BUILD_HASH=unknown
WORKDIR /src
COPY NOTICE.txt README.md ./
COPY server/ server/
COPY --from=webapp /src/webapp/channels/dist webapp/channels/dist
WORKDIR /src/server
# PLUGIN_PACKAGES= skips downloading prepackaged plugins; install them from the Marketplace instead.
RUN --mount=type=cache,target=/root/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    mkdir -p bin \
 && make build-linux-${TARGETARCH} package-linux-${TARGETARCH} \
      BUILD_HASH=${BUILD_HASH} PLUGIN_PACKAGES= \
 && mkdir /out \
 && tar -xzf dist/mattermost-*-linux-${TARGETARCH}.tar.gz -C /out

# ---- Runtime ----
FROM ubuntu:noble
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ARG PUID=2000
ARG PGID=2000
# Document-text extractors used for file search, same set as upstream's image.
# postgresql-client-17 comes from PGDG (noble ships 16, which cannot dump a 17 server); the backup job runs pg_dump.
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y \
      ca-certificates media-types mailcap unrtf wv poppler-utils tidy tzdata curl gnupg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt noble-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y postgresql-client-17 \
 && apt-get purge -y --auto-remove curl gnupg \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid ${PGID} mattermost \
 && useradd --uid ${PUID} --gid ${PGID} --comment "" --home-dir /mattermost mattermost

COPY --from=server --chown=mattermost:mattermost /out/mattermost /mattermost
RUN mkdir -p /mattermost/data /mattermost/plugins /mattermost/client/plugins /mattermost/.postgresql \
 && chmod 700 /mattermost/.postgresql \
 && chown mattermost:mattermost /mattermost/data /mattermost/plugins /mattermost/client/plugins /mattermost/.postgresql

ENV PATH="/mattermost/bin:${PATH}"
ENV MM_SERVICESETTINGS_ENABLELOCALMODE="true"
ENV MM_INSTALL_TYPE="docker"

USER mattermost
WORKDIR /mattermost
# mmctl calls /api/v4/system/ping (with DB and filestore checks) over the local-mode socket; curl is not in the image.
# start-period covers boot plus schema migrations after an upgrade; Coolify reads this status for the compose app.
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 CMD ["/mattermost/bin/mmctl", "system", "status", "--local"]
CMD ["/mattermost/bin/mattermost"]
EXPOSE 8065 8067 8074
VOLUME ["/mattermost/data", "/mattermost/logs", "/mattermost/config", "/mattermost/plugins", "/mattermost/client/plugins"]
