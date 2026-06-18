---
name: docker-helper
description: "Generate Dockerfiles, docker-compose files, and help with Docker operations. Use when user asks about Docker configuration, containerization, or Docker commands."
version: 1.0.0
author: omagt
license: MIT
metadata:
  tags: [Docker, Container, Dockerfile, docker-compose, DevOps]
allowed-tools: "read,write,shell"
---

# Docker Helper

Generate and review Docker configurations.

## When to use

- User asks to "Dockerize this app" or "create a Dockerfile"
- User wants to write a docker-compose.yml for multi-service setups
- User asks about Docker best practices
- User needs help debugging a Docker build/run issue

---

## Dockerfile Generation

### Template: Node.js / TypeScript App

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
USER appuser
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

### Template: Python App

```dockerfile
FROM python:3.12-slim
WORKDIR /app
RUN groupadd -r app && useradd -r -g app app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
USER app
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## Docker Best Practices Checklist

When generating or reviewing a Dockerfile, check:

1. **Multi-stage builds** — separate build deps from runtime image
2. **Non-root user** — `USER` directive for runtime
3. **Minimal base image** — alpine or slim variants
4. **Layer caching** — copy package files before source code
5. **`.dockerignore`** — exclude node_modules, .git, dist, .env
6. **Health checks** — `HEALTHCHECK` for service monitoring
7. **No secrets in image** — use build args or secrets mount for tokens
8. **Pin versions** — `FROM node:22-alpine` not `FROM node:latest`
9. **One process per container** — don't run nginx + app in same container
10. **Clean up** — `apt-get clean && rm -rf /var/lib/apt/lists/*` in same layer

---

## docker-compose.yml Template

```yaml
version: "3.8"
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgres://user:pass@db:5432/mydb
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: mydb
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user -d mydb"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

---

## Common Commands

```bash
# Build and run
docker build -t myapp .
docker run -p 3000:3000 --env-file .env myapp

# Compose
docker compose up -d
docker compose logs -f
docker compose down

# Cleanup
docker system prune -a  # ⚠️ removes all unused images/containers/volumes
docker builder prune     # clean build cache
```

## Constraints

- Never hardcode secrets in Dockerfiles or compose files
- Always recommend `.env` files (added to `.gitignore`)
- Warn about `docker system prune -a` before suggesting it
- For production, consider orchestration (k8s/nomad) beyond docker-compose
