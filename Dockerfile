FROM node:22-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend ./
# vite.config.ts writes the bundle to ../src/book_reader/static/app, i.e. /app/src/...
RUN npm run build

FROM ghcr.io/astral-sh/uv:0.13.7 AS uv
FROM python:3.12-slim-bookworm
COPY --from=uv /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --extra pageindex --extra agent --no-install-project
COPY src ./src
COPY --from=frontend /app/src/book_reader/static/app ./src/book_reader/static/app
COPY README.md ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --extra pageindex --extra agent
ENV PATH="/app/.venv/bin:$PATH" BOOK_READER_HOST=0.0.0.0 BOOK_READER_PORT=8000
EXPOSE 8000
CMD ["book-reader", "--library", "/library", "--state-dir", "/state"]
