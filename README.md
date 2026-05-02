# compose-gen

Gerador simples de `docker-compose` com:

- `app-client/compose-gen`: Angular
- `app-server`: Express + Zod + YAML + Prisma
- PostgreSQL para salvar presets de stack

## Subir backend com Docker

```bash
docker compose up -d --build
```

## Endpoints do app-server

- `GET /health`
- `POST /generate`
- `GET /stacks`
- `POST /stacks`

## Exemplo de stack salva

```json
{
  "name": "Node Postgres Base",
  "backend": "node",
  "database": "postgres",
  "cache": "redis",
  "adminTools": ["pgadmin"]
}
```
