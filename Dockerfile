FROM node:22-bookworm-slim

# Install FFmpeg and ffprobe in the production image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install the locked production dependencies.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
ENV NODE_ENV=production
EXPOSE 8000

CMD ["node", "app.js"]