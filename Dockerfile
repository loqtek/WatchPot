# Next.js standalone — build from repository root (same context as package.json).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG WATCHPOT_PUBLIC_HOST=localhost
ARG NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN RESOLVED="${NEXT_PUBLIC_API_URL:-https://${WATCHPOT_PUBLIC_HOST}/api}" && \
    echo "NEXT_PUBLIC_API_URL=$RESOLVED" && \
    NEXT_PUBLIC_API_URL="$RESOLVED" npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3020
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3020
CMD ["node", "server.js"]
