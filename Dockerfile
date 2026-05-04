FROM node:22-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV AUTH_SECRET=build-placeholder
ENV AUTH_TRUST_HOST=true
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Install Python + pip for AKShare futures data backend
RUN apk add --no-cache python3 py3-pip py3-numpy py3-pandas && \
    python3 -m pip install --no-cache-dir --break-system-packages \
      akshare fastapi uvicorn

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy the futures FastAPI app
COPY --chown=nextjs:nodejs futures-api.py ./futures-api.py
COPY --chown=nextjs:nodejs start.sh ./start.sh
RUN chmod +x start.sh

USER nextjs
EXPOSE 3000
CMD ["./start.sh"]
