# API image. Build from the repo root:  docker build -f apps/api/Dockerfile .
FROM public.ecr.aws/docker/library/node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @replyfinch/api build
# Standalone folder with only the API's production dependencies.
RUN pnpm --filter @replyfinch/api deploy --legacy --prod /out

FROM public.ecr.aws/docker/library/node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
EXPOSE 4000
USER node
CMD ["node", "dist/index.js"]
