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
ARG SIGNAL_PACKAGE=@signal/ops-console
ARG SIGNAL_OUTPUT=apps/ops-console/dist
ARG EXPO_PUBLIC_API_URL=http://localhost:3000
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
RUN pnpm --filter "${SIGNAL_PACKAGE}..." build \
  && mkdir -p /static \
  && cp -R "$SIGNAL_OUTPUT"/. /static/

FROM nginx:1.31.5-alpine
COPY infra/nginx/spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /static /usr/share/nginx/html
EXPOSE 8080
