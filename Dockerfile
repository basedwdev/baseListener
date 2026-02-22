# ── Build stage ──────────────────────────────────────────────────────────────
# Separate stage so devDependencies don't make it into the final image.
FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine

# Least-privilege: run as a non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy only the production node_modules from the build stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY src/ ./src/

# Pre-create directories so SQLite and log rotation work on first boot
RUN mkdir -p data logs && chown -R appuser:appgroup /app

USER appuser

# No port exposed — this service only communicates via Redis pub/sub

CMD ["node", "src/index.js"]
