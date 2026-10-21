FROM node:22.20.0-alpine
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/money/package.json packages/money/package.json
ARG DATABASE_URL=postgresql://monikey:local-only-change-me@127.0.0.1:5432/monikey?schema=public
RUN npm ci
COPY . .
RUN npm run build --workspace @monikey/contracts
EXPOSE 3000
CMD ["npm", "run", "dev", "--workspace", "@monikey/api"]
