# ==========================================
# bahAI — Production Docker Image
# Multi-stage build: frontend build → backend runtime
# ==========================================

# Stage 1: Build frontend
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
# Shared wire contract — the frontend resolves @bahai/shared -> ../shared/contract.js
# (repo-root shared/ dir), so it must be present in the build context.
COPY shared/ ../shared/
RUN npm run build

# Stage 2: Production runtime
FROM node:22-alpine AS runtime
WORKDIR /app

# Install system deps for tesseract OCR (optional — comment out to reduce image size)
RUN apk add --no-cache \
    tesseract-ocr \
    tesseract-ocr-data-eng \
    && rm -rf /var/cache/apk/*

# Backend dependencies
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev --ignore-scripts

# Copy backend source
COPY backend/ ./backend/

# Shared wire contract — backend/chat/sse.js requires ../../shared/contract
COPY shared/ ./shared/

# Copy built frontend
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/auth/config || exit 1

# Runtime configuration
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

# Start backend (serves frontend static files too)
CMD ["node", "backend/index.js"]
