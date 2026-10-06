FROM node:24-alpine
WORKDIR /app
RUN corepack enable
COPY deploy/runtime/package.json deploy/runtime/pnpm-lock.yaml ./
RUN corepack prepare pnpm@11.25.0 --activate && pnpm install --prod --frozen-lockfile --ignore-scripts
COPY api ./api
COPY src/store.cjs src/version-id.cjs src/minecraft-metadata.cjs ./src/
COPY src/content-format.cjs src/archive-validation.cjs ./src/
COPY src/assets/minecraft-cherry-panorama.png ./src/assets/
COPY scripts/backup-api.cjs scripts/restore-api.cjs scripts/backup-common.cjs scripts/bootstrap-api.cjs ./scripts/
COPY LICENSE THIRD_PARTY_NOTICES.md ./
RUN mkdir -p /var/lib/petal && chown node:node /var/lib/petal
USER node
LABEL bloom.storage.path="/var/lib/petal" bloom.storage.uid="1000"
ENV PETAL_API_HOST=0.0.0.0 PETAL_API_PORT=4318 PETAL_API_DATA_DIR=/var/lib/petal
EXPOSE 4318
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:4318/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "api/server.cjs"]
