# Production Deployment Guide

## Prerequisites
- Docker + Docker Compose
- Domain name with TLS certificate (or use Let's Encrypt)
- Strong passwords for DB and API
- OpenClaw gateway running and accessible

## 1. Environment Configuration

Create `.env` in this directory with:

```bash
POSTGRES_PASSWORD=strong-random-db-password
API_USER=admin
API_PASS=strong-api-password
OPENCLAW_GATEWAY_URL=ws://host.docker.internal:18789
OPENCLAW_GATEWAY_TOKEN=  # if your gateway requires a token
```

## 2. Network Isolation

Create a dedicated Docker network:

```bash
docker network create mission-control-lan
```

## 3. Start the Stack (Production)

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

This starts:
- `db` (Postgres, no port exposed to host)
- `db-init` (schema + seed)
- `bridge-logger`
- `task-worker`
- `app` (production Next.js server on port 3000)

## 4. Reverse Proxy (Nginx)

Place the provided `nginx.conf` in your proxy and enable TLS.

Example Nginx site config:

```nginx
upstream mission_control {
  server 127.0.0.1:3000;
}

server {
  listen 443 ssl http2;
  server_name dashboard.example.com;

  ssl_certificate /etc/letsencrypt/live/dashboard.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/dashboard.example.com/privkey.pem;

  # Basic Auth
  auth_basic "Restricted";
  auth_basic_user_file /etc/nginx/.htpasswd;

  location / {
    proxy_pass http://mission_control;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

Generate htpasswd:
```bash
htpasswd -c /etc/nginx/.htpasswd admin
# enter the same password as API_PASS for consistency
```

## 5. Health Checks

- UI health: `http://localhost:3000/health`
- DB: `docker exec mission-control-db pg_isready -U openclaw -d mission_control`

## 6. Backups

Daily backup script (run via cron):

```bash
#!/bin/bash
BACKUP_DIR=/backups/mission-control
DATE=$(date +%F)
docker run --rm \
  -v mission-control_pgdata:/data \
  -v $BACKUP_DIR:/backup \
  alpine \
  tar czf /backup/pgdata-$DATE.tar.gz -C /data .
```

Restore:
```bash
docker compose down
docker run --rm -v mission-control_pgdata:/data -v $BACKUP_DIR:/backup alpine sh -c "rm -rf /data/* && tar xzf /backup/pgdata-2026-03-23.tar.gz -C /data"
docker compose up -d
```

## 7. Monitoring

Metrics endpoint: `http://localhost:3000/api/tasks/worker-metrics`
- `enabled`
- `maxConcurrency`
- `activeNow`
- `queuedCount`
- `lastTickAt`

For Prometheus, add a simple textfile collector or call the endpoint.

## 8. Security Checklist

- [ ] `POSTGRES_PASSWORD` is strong (>20 chars)
- [ ] `API_USER`/`API_PASS` set and not default
- [ ] Postgres port 5432 not published to host (`ports` removed in prod compose)
- [ ] All containers run as non-root (`user: "nodejs"` set)
- [ ] TLS enabled in reverse proxy
- [ ] `.env` is gitignored and backups are encrypted
- [ ] `gateway.bind` set to `"lan"` or `"auto"` in host openclaw.json
- [ ] Log rotation configured for Docker logs (`log-opts`)

## 9. Updates

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Check for breaking DB schema changes in `db/schema.sql`.

## 10. Support

See main README.md for troubleshooting.