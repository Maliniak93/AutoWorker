# syntax=docker/dockerfile:1

# Build stage: the full image carries python3, make and g++ for node-pty.
FROM node:24-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY tests ./tests
RUN npm run build && npm prune --omit=dev

# Runtime stage: same Debian release and architecture, so the compiled
# node-pty binary copied from the build stage loads without build tools.
FROM node:24-bookworm-slim
ARG CLAUDE_CODE_VERSION=latest

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl \
  && mkdir -p -m 755 /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
  && npm cache clean --force

WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/dist/client ./dist/client

RUN mkdir -p /data && chown node:node /data

ENV HOST=0.0.0.0 \
    PORT=4280 \
    AUTOWORKER_DATA_DIR=/data

USER node
EXPOSE 4280
CMD ["node", "src/server/main.ts"]
