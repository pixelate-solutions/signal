# syntax=docker/dockerfile:1.7

FROM mcr.microsoft.com/playwright:v1.61.1-noble AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=signal-pnpm-store,target=/pnpm/store,sharing=locked \
  pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=signal-pnpm-store,target=/pnpm/store,sharing=locked \
  pnpm install --offline --frozen-lockfile \
  && pnpm --filter "@signal/browser-worker..." build \
  && pnpm --filter "@signal/browser-worker" deploy --prod --legacy /runtime

FROM mcr.microsoft.com/playwright:v1.61.1-noble
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN groupadd --gid 10001 signal \
  && useradd --uid 10001 --gid signal --create-home signal
WORKDIR /app
COPY --from=build --chown=signal:signal /runtime/ ./
USER signal
EXPOSE 3200
CMD ["node", "dist/host.js"]
