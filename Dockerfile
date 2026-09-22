# --- build the client -------------------------------------------------
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src

# No VITE_SIGNALING_URL: the client talks to /ws on its own origin, so one image
# runs in every environment.
ARG VITE_STUN_SERVERS=stun:stun.l.google.com:19302
ENV VITE_STUN_SERVERS=$VITE_STUN_SERVERS

RUN npx tsc -p tsconfig.json && npx vite build

# --- run --------------------------------------------------------------
FROM node:24-alpine AS run

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# tsx runs the TypeScript server directly; not a runtime dependency of the game.
RUN npm install --no-save tsx@^4.19.2

COPY tsconfig.server.json ./
COPY server ./server
COPY src/config ./src/config
COPY src/networking/SignalingProtocol.ts ./src/networking/SignalingProtocol.ts
COPY src/room/RoomId.ts ./src/room/RoomId.ts
COPY --from=build /app/dist ./dist

ENV PORT=8080
ENV STATIC_DIR=/app/dist
EXPOSE 8080

USER node

HEALTHCHECK --interval=5s --timeout=3s --retries=12 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["npx", "tsx", "server/index.ts"]
