# syntax=docker/dockerfile:1
#
# Vehicle Atlas: builds the vehicle data and the site, then serves the static files with Caddy.
#
#   docker build -t vehicle-atlas .
#   docker run -d -p 8080:80 vehicle-atlas                    → http://<server>:8080
#   docker run -d -p 80:80 -p 443:443 -p 443:443/udp \
#     -e SITE_ADDRESS=atlas.example.com -v atlas-data:/data vehicle-atlas
#                                                             → https://atlas.example.com, certificate included
#
# Or `docker compose up -d --build` (see compose.yaml).

FROM node:24.22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
# strict data build, type check and bundle, then the unit tests: a failing check never ships
RUN npm run build && npm test && node tools/precompress.mjs dist

FROM caddy:2.11-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
ENV SITE_ADDRESS=:80
EXPOSE 80 443 443/udp
