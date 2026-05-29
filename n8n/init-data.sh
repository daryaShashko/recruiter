#!/bin/bash
# init-data.sh — создаёт non-root пользователя для n8n в PostgreSQL
# Запускается автоматически при первом старте postgres контейнера

set -e

# POSTGRES_NON_ROOT_USER и POSTGRES_NON_ROOT_PASSWORD берутся из env (docker-compose.yml)

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER ${POSTGRES_NON_ROOT_USER} WITH PASSWORD '${POSTGRES_NON_ROOT_PASSWORD}';
    GRANT ALL PRIVILEGES ON DATABASE ${POSTGRES_DB} TO ${POSTGRES_NON_ROOT_USER};
    \c ${POSTGRES_DB}
    GRANT ALL ON SCHEMA public TO ${POSTGRES_NON_ROOT_USER};
EOSQL
