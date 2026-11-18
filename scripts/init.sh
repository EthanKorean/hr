#!/usr/bin/env bash
# HR 프로젝트 초기화 스크립트 (Linux / macOS 겸용, macOS 기본 bash 3.2 호환)
#
#   ./scripts/init.sh           .env(비밀 아닌 설정) 준비 + 비밀번호 입력 + 컨테이너 빌드/기동
#   ./scripts/init.sh --reset   컨테이너와 볼륨(DB 데이터 포함) 삭제 후 처음부터
#   ./scripts/init.sh --down    컨테이너 중지
#   ./scripts/init.sh --logs    서비스 로그 보기
#
# 비밀번호(DB root / DB / Admin)는 실행 시 숨김 입력으로 받으며 어떤 파일에도 저장하지 않는다.
# 비대화형: HR_DB_ROOT_PASSWORD, HR_DB_PASSWORD, HR_ADMIN_PASSWORD 환경변수로 미리 지정하면 프롬프트를 건너뛴다.
set -euo pipefail

cd "$(dirname "$0")/.."

log()  { printf '\033[1;34m[init]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

# shellcheck disable=SC1091
. ./scripts/lib/secrets.sh

# ---------- 1. 사전 점검 ----------
OS="$(uname -s)"
case "$OS" in
  Darwin) log "macOS 감지" ;;
  Linux)  log "Linux 감지" ;;
  *)      die "지원하지 않는 OS: $OS" ;;
esac

command -v docker >/dev/null 2>&1 || die "docker 가 없습니다. macOS: Docker Desktop 또는 OrbStack/Colima 설치"
command -v openssl >/dev/null 2>&1 || die "openssl 이 필요합니다."
command -v curl >/dev/null 2>&1 || die "curl 이 필요합니다."

if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  die "docker compose 를 찾을 수 없습니다."
fi

docker info >/dev/null 2>&1 || die "docker 데몬에 연결할 수 없습니다. (macOS: Docker Desktop/OrbStack 실행 확인)"

# --reset/--down 은 .env 가 없어도 실행될 수 있다. 이때 compose 프로젝트 이름이 디렉터리 이름으로 바뀌면
# 'hr_db_data' 볼륨을 찾지 못해 삭제되지 않으므로, .env 값(없으면 hr)으로 항상 고정한다.
if [ -z "${COMPOSE_PROJECT_NAME:-}" ] && [ -f .env ]; then
  COMPOSE_PROJECT_NAME="$(grep '^COMPOSE_PROJECT_NAME=' .env | tail -n1 | cut -d= -f2- || true)"
fi
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-hr}"

# ---------- 2. 옵션 처리 ----------
case "${1:-}" in
  --down)  fill_placeholder_secrets; log "컨테이너 중지"; $DC down; exit 0 ;;
  --logs)  fill_placeholder_secrets; exec $DC logs -f --tail=100 gateway auth-service tenant-service ;;
  --reset)
    fill_placeholder_secrets
    warn "컨테이너와 볼륨(DB 데이터)을 모두 삭제합니다."
    $DC down -v
    ;;
  "") ;;
  *) die "알 수 없는 옵션: $1 (--reset | --down | --logs)" ;;
esac

# ---------- 3. .env (비밀 아닌 설정) 준비 ----------
# 이미 있는 키는 건드리지 않고, 없는 키만 .env.example 에서 추가한다.
# (sed -i 는 GNU/BSD 문법이 달라서 쓰지 않는다.)
[ -f .env ] && log ".env 이미 존재 - 누락된 키만 보충" || { log ".env 생성 (비밀번호는 저장하지 않음)"; (umask 077; : > .env); }
scrub_env_secrets .env # 이전 버전이 저장해 둔 비밀 항목이 있으면 제거
[ -s .env ] && [ -n "$(tail -c1 .env)" ] && echo >> .env # 마지막 줄 개행이 없으면 첫 추가 키가 그 줄에 붙어 깨진다
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ""|\#*) continue ;;
    *=*) key="${line%%=*}"; val="${line#*=}" ;;
    *) continue ;;
  esac
  grep -q "^${key}=" .env && continue
  if [ "$val" = "__POLLING__" ]; then [ "$OS" = Darwin ] && val=true || val=false; fi
  printf '%s=%s\n' "$key" "$val" >> .env
done < .env.example
chmod 600 .env

# shellcheck disable=SC1091
set -a; . ./.env; set +a

# ---------- 4. 비밀번호 입력 (저장 안 함) ----------
DB_VOLUME="${COMPOSE_PROJECT_NAME}_db_data"
if docker volume inspect "$DB_VOLUME" >/dev/null 2>&1; then
  HAS_VOLUME=1
else
  HAS_VOLUME=0
fi

if [ "$HAS_VOLUME" = 0 ]; then
  log "최초 구성: 비밀번호를 입력하세요. (${SECRET_MIN}자 이상, 화면에 표시되지 않으며 어디에도 저장되지 않습니다)"
  prompt_secret DB_ROOT_PASSWORD "MariaDB root 비밀번호"
  prompt_secret DB_PASSWORD "MariaDB 서비스 계정(${DB_USER}_*) 비밀번호"
  prompt_secret ADMIN_PASSWORD "Admin(${ADMIN_EMAIL}) 로그인 비밀번호"
  warn "입력한 비밀번호는 저장되지 않으니 직접 보관하세요. (DB 비밀번호는 init 재실행 때 다시 필요합니다)"
else
  log "기존 DB 볼륨(${DB_VOLUME}) 감지: 최초 구성 때 입력한 DB 비밀번호가 필요합니다."
  # root/Admin 비밀번호는 최초 초기화 때만 쓰이므로 재실행에서는 묻지 않는다.
  export DB_ROOT_PASSWORD="unused-existing-volume"
  prompt_secret DB_PASSWORD "MariaDB 서비스 계정(${DB_USER}_*) 비밀번호" 0
  # Admin 비밀번호: 이미 admin 이 만들어져 있으면 쓰이지 않는다. 첫 기동이 admin 생성 전에 실패했을 수도 있으므로
  # (볼륨만 있고 admin 이 없는 상태) 비워 두지 않고 선택 입력으로 받는다. Enter 만 누르면 건너뜀.
  prompt_secret ADMIN_PASSWORD "Admin(${ADMIN_EMAIL}) 비밀번호 (admin 이 이미 있으면 Enter 로 건너뜀)" 0 72 optional
  # DB 컨테이너가 이미 떠 있으면 입력한 비밀번호가 맞는지 바로 확인한다.
  if [ -n "$($DC ps -q db 2>/dev/null || true)" ]; then
    if ! $DC exec -T -e MYSQL_PWD="$DB_PASSWORD" db mariadb -u"${DB_USER}_auth" -e 'SELECT 1' >/dev/null 2>&1; then
      die "DB 비밀번호가 기존 구성과 다릅니다. 모르면 ./scripts/init.sh --reset (DB 데이터 삭제)"
    fi
  fi
fi
# 아래 두 값은 저장하지 않고 매 실행마다 메모리에서 새로 만든다. (재실행하면 발급된 로그인 토큰은 무효가 된다)
export JWT_SECRET="$(gen_hex 32)"
export INTERNAL_KEY="$(gen_hex 16)"

# ---------- 5. 빌드 & 기동 ----------
log "이미지 빌드 및 컨테이너 기동"
if [ "$HAS_VOLUME" = 1 ]; then
  # 재실행에서는 root 비밀번호를 자리표시 값으로 쓰므로, DB/Redis/MQTT 는 설정이 달라 보여도 재생성하지 않는다(DB 재시작 방지).
  $DC up -d --no-recreate db redis mqtt
  $DC up -d --build --no-deps auth-service tenant-service gateway frontend
else
  $DC up -d --build
fi

# ---------- 6. 서비스 헬스 대기 ----------
log "서비스 기동 대기 (마이그레이션 포함)"
ok=0
i=0
while [ "$i" -lt 60 ]; do
  if curl -fs "http://localhost:${GATEWAY_PORT}/api/health" >/dev/null 2>&1; then ok=1; break; fi
  i=$((i + 1)); sleep 2
done
[ "$ok" -eq 1 ] || {
  $DC logs --tail=50 gateway auth-service tenant-service
  die "서비스가 기동하지 않았습니다. (기존 볼륨이 있다면 DB 비밀번호가 최초 입력값과 같은지 확인)"
}

cat <<EOF

  ✅ 준비 완료

  Frontend : http://localhost:${FRONTEND_PORT}
  Gateway  : http://localhost:${GATEWAY_PORT}/api/health
  MariaDB  : localhost:${DB_PORT}  (db=${AUTH_DB_NAME},${TENANT_DB_NAME} user=${DB_USER}_auth,${DB_USER}_tenant)
  MQTT     : mqtt://localhost:${MQTT_PORT}
  Redis    : localhost:${REDIS_PORT}

  Admin 로그인: ${ADMIN_EMAIL} / (init 중 입력한 비밀번호 - 저장되지 않음)

  로그 보기   : ./scripts/init.sh --logs
  MQTT 구독   : mosquitto_sub -h localhost -p ${MQTT_PORT} -t 'hr/#' -v
  중지        : ./scripts/init.sh --down
  완전 초기화 : ./scripts/init.sh --reset
EOF
