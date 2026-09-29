# The container a fix runs its commands in (lib/sandbox.ts): Node for the
# site's own install, build and lint, PHP for `php -l`, Git to put the checkout
# back between commands. The egress proxy (egress.mjs) runs from it too.
# Built by the worker on start.
FROM node:24-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git php-cli \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && mkdir /work && chown node:node /work
COPY egress.mjs /opt/egress.mjs
ENV CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
USER node
WORKDIR /work
