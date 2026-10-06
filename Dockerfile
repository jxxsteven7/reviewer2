# The whole app in one image: one Node process serves the front end and Socket.IO on PORT
# (docs/rules/constraints.md). See docs/development.md for building and running it.

FROM node:24-alpine AS build
WORKDIR /app
# Install first, from the manifests alone, so that this layer stays cached until they change.
# --ignore-scripts skips the "prepare" script, which turns on git hooks and has no git here.
COPY package.json package-lock.json .npmrc ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --ignore-scripts
COPY . .
ARG APP_VERSION=dev
RUN APP_VERSION="$APP_VERSION" npm run build

# The server is bundled into one file, so the runtime image needs no node_modules.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
COPY words words
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:$PORT/healthz" >/dev/null || exit 1
CMD ["node", "server/dist/index.cjs"]
