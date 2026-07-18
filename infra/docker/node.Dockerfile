# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=signal-pnpm-store,target=/pnpm/store,sharing=locked \
  pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=signal-pnpm-store,target=/pnpm/store,sharing=locked \
  pnpm install --offline --frozen-lockfile
ARG SIGNAL_PACKAGE=@signal/api
RUN --mount=type=cache,id=signal-pnpm-store,target=/pnpm/store,sharing=locked \
  pnpm --filter "${SIGNAL_PACKAGE}..." build \
  && pnpm --filter "${SIGNAL_PACKAGE}" deploy --prod --legacy /runtime

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN groupadd --gid 10001 signal \
  && useradd --uid 10001 --gid signal --create-home signal
WORKDIR /app
COPY --from=build --chown=signal:signal /runtime/ ./
USER signal
CMD ["node", "dist/main.js"]
