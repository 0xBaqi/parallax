FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY fixtures ./fixtures
COPY curated ./curated
COPY scripts ./scripts
RUN node scripts/build.mjs
ENV NODE_ENV=production
CMD ["sleep", "3600"]
