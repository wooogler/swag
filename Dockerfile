# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --only=production && npm cache clean --force

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set dummy environment variables for build time only
# Real values will be injected at runtime via --env-file
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
ENV POSTGRES_URL="postgresql://dummy:dummy@localhost:5432/dummy"
ENV OPENAI_API_KEY="sk-dummy-key-for-build-only"

# Install all dependencies (including dev) and build
RUN npm install && npm run build

# Stage 3: Runner (Production)
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# ffmpeg, for one job: rewriting a finished screen recording's container.
#
# A MediaRecorder writes a LIVE WebM — the Segment has unknown size and there is
# no Duration in the header, because nothing knew how long the recording would
# run. Players cannot seek such a file and show a total time that climbs as they
# read it. `ffmpeg -c copy` rewrites the header and nothing else: measured at
# 0.06s for a nine-minute capture, so the download route can do it per request.
#
# It is NOT here to transcode. Re-encoding that same nine-minute clip to H.264
# did not finish in six and a half minutes on this hardware — slower than the
# recording itself, and a study block is twenty-five minutes.
RUN apk add --no-cache ffmpeg tzdata

# The container's idea of "local time", which is otherwise UTC.
#
# Recording filenames are stamped in local time, and they are built in two
# places: here, for the console's download, and on the host, for the bulk pull
# script. Left at UTC the two would name the same recording four hours apart —
# and the whole point of one naming rule is that a file grabbed mid-session and
# the same file pulled afterwards are one file. tzdata above is what makes a
# named zone resolvable at all; without it this silently stays UTC.
ENV TZ=America/New_York

# Create non-root user (SECURITY)
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built app
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Run as non-root user
USER nextjs

# Expose port (internal only - will bind to 127.0.0.1 in Podman)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "server.js"]
