FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node . .
USER node
ENV NODE_ENV=production DATA_DIR=/data PORT=8080 TZ=Europe/Moscow
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node healthcheck.js
CMD ["node","server.js"]
