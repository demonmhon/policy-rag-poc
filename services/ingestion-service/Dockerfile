FROM node:24-alpine
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* tsconfig.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install
COPY src ./src
RUN pnpm build
EXPOSE 3001
CMD ["pnpm", "start"]
