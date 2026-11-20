# ---------- بناء ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

# su-exec للانتقال من root إلى مستخدم التطبيق بعد ضبط ملكية قرص Render
RUN apk add --no-cache su-exec  && addgroup -S app && adduser -S app -G app

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY server ./server
COPY tools ./tools
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# بصمة البناء (الإصدار + ختم Service Worker)
RUN node tools/build.mjs  && mkdir -p /app/data  && chmod +x /usr/local/bin/docker-entrypoint.sh  && chown -R app:app /app

# نبدأ كـroot فقط لضبط ملكية القرص، ثم entrypoint ينزل إلى app
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
EXPOSE 3000
ENV PORT=3000 DATA_DIR=/app/data

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
