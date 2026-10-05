FROM node:24-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY api ./api
COPY src/store.cjs ./src/store.cjs
COPY LICENSE THIRD_PARTY_NOTICES.md ./
RUN mkdir -p /app/api/data && chown -R node:node /app
USER node
ENV PETAL_API_HOST=0.0.0.0 PETAL_API_PORT=4318
EXPOSE 4318
CMD ["node", "api/server.cjs"]
