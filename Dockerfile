FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN DATABASE_URL=postgresql://u:p@localhost:5432/db DIRECT_URL=postgresql://u:p@localhost:5432/db npx prisma generate && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S mailpulse && adduser -S mailpulse -G mailpulse
COPY --from=build --chown=mailpulse:mailpulse /app/.next/standalone ./
COPY --from=build --chown=mailpulse:mailpulse /app/.next/static ./.next/static
COPY --from=build --chown=mailpulse:mailpulse /app/public ./public
COPY --from=build --chown=mailpulse:mailpulse /app/node_modules ./node_modules
COPY --from=build --chown=mailpulse:mailpulse /app/src ./src
COPY --from=build --chown=mailpulse:mailpulse /app/prisma ./prisma
USER mailpulse
EXPOSE 3000
CMD ["node", "server.js"]
