#!/usr/bin/env bash
# Playwright 화면 테스트. .env 의 설정과 암호화해 보관한 Admin 비밀번호(vault)를 환경으로 올려 실행한다.
#   ./scripts/e2e.sh                 전체 실행
#   ./scripts/e2e.sh -g "등록"        인자는 playwright test 에 그대로 전달
# 보관한 비밀번호가 없으면 숨김 입력으로 받는다(저장하려면 ./scripts/vault.sh set ADMIN_PASSWORD).
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
. ./scripts/lib/vault.sh

[ -f .env ] || { echo ".env 가 없습니다. 먼저 ./scripts/init.sh 를 실행하세요." >&2; exit 1; }
set -a; . ./.env; set +a

if pw="$(vault_get ADMIN_PASSWORD 2>/dev/null)"; then
  ADMIN_PASSWORD="$pw"
else
  echo "보관된 ADMIN_PASSWORD 가 없습니다. 입력하세요(저장하지 않음)." >&2
  IFS= read -r -s -p "Admin(${ADMIN_EMAIL}) 비밀번호: " ADMIN_PASSWORD; echo >&2
fi
unset pw
export ADMIN_PASSWORD

cd e2e
[ -d node_modules ] || npm install --no-audit --no-fund
exec npx playwright test "$@"
