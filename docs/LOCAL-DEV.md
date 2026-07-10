# Local Development

## Quickstart (3 pasos)

```bash
# 1. Copiar env defaults
cp .env.dev.example .env.dev

# 2. Levantar todo (postgres + localstack + cdk-deployer + frontend)
scripts/dev-up.sh
# o equivalentemente:
docker compose --env-file .env.dev -f docker-compose.dev.yml up -d

# 3. Esperar ~3 minutos (primera vez tarda más por build) y abrir
open http://localhost:5173
```

## URLs

| Servicio          | URL                                        | Notas                                         |
| ----------------- | ------------------------------------------ | --------------------------------------------- |
| Frontend (Vite)   | <http://localhost:5173>                    | Login screen                                  |
| LocalStack API    | <http://localhost:4566>                    | Lambda + API Gateway                          |
| LocalStack health | <http://localhost:4566/_localstack/health> | Status check                                  |
| PostgreSQL        | localhost:5432                             | user=ceiba, pass=ceiba_dev, db=mercadoexpress |

## Troubleshooting

### Puerto ocupado

Cambiar `POSTGRES_PORT` o `LOCALSTACK_PORT` en `.env.dev` (ej. `POSTGRES_PORT=5433`).

### DB se ensució

```bash
scripts/dev-down.sh  # incluye -v (borra volúmenes)
scripts/dev-up.sh
```

### API URL cambió

```bash
rm .docker-shared/.api-url
docker compose --env-file .env.dev -f docker-compose.dev.yml restart deployer
```

### Cold start muy lento

- Primera vez: ~5min (build de imágenes Docker)
- Siguientes: < 30s

### Ver logs

```bash
docker compose -f docker-compose.dev.yml logs -f deployer
docker compose -f docker-compose.dev.yml logs -f frontend
```

## Reset completo

```bash
scripts/dev-down.sh
docker system prune -f
scripts/dev-up.sh
```
