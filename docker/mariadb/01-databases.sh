#!/bin/bash
# 서비스별 DB 스키마 + 전용 계정 분리 (MSA: 서비스는 자기 DB 만 접근). 빈 볼륨 최초 기동 시 1회 실행된다.
#   <DB_USER>_auth   -> AUTH_DB_NAME 만 접근
#   <DB_USER>_tenant -> TENANT_DB_NAME 만 접근
set -e
mariadb -uroot -p"${MARIADB_ROOT_PASSWORD}" <<SQL
CREATE DATABASE IF NOT EXISTS \`${AUTH_DB_NAME}\`   CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS \`${TENANT_DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}_auth'@'%'   IDENTIFIED BY '${DB_PASSWORD}';
CREATE USER IF NOT EXISTS '${DB_USER}_tenant'@'%' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL ON \`${AUTH_DB_NAME}\`.*   TO '${DB_USER}_auth'@'%';
GRANT ALL ON \`${TENANT_DB_NAME}\`.* TO '${DB_USER}_tenant'@'%';
FLUSH PRIVILEGES;
SQL
