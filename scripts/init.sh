#!/usr/bin/env bash
# HR 프로젝트 초기화 스크립트 (Linux / macOS 겸용, macOS 기본 bash 3.2 호환)
#
#   ./scripts/init.sh           .env(비밀 아닌 설정) 준비 + 비밀번호 입력 + 컨테이너 빌드/기동
#   ./scripts/init.sh --reset   컨테이너와 볼륨(DB 데이터 포함)과 보관해 둔 비밀번호를 삭제 후 처음부터
#   ./scripts/init.sh --ask     보관해 둔 비밀번호를 쓰지 않고 새로 입력받는다
#   ./scripts/init.sh --down    컨테이너 중지
#   ./scripts/init.sh --logs    서비스 로그 보기
#
# 비밀번호(DB root / DB / Admin)는 실행 시 숨김 입력으로 받는다. 평문으로는 어떤 파일에도 저장하지 않고,
# 기동에 성공하면 DEK(저장소 밖 ~/.config/hr/dek.key)로 암호화해 .secrets.enc 에 보관한다(scripts/lib/vault.sh).
# 다음 실행부터는 보관한 값을 쓰므로 다시 묻지 않는다. 확인/관리: ./scripts/vault.sh
# 비대화형: HR_DB_ROOT_PASSWORD, HR_DB_PASSWORD, HR_ADMIN_PASSWORD 환경변수로 미리 지정하면 프롬프트를 건너뛴다.
set -euo pipefail

cd "$(dirname "$0")/.."

log()  { printf '\033[1;34m[init]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

# shellcheck disable=SC1091
. ./scripts/lib/secrets.sh
# shellcheck disable=SC1091
. ./scripts/lib/vault.sh

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
IGNORE_VAULT=0 # 1 이면 암호화해 보관한 비밀번호를 쓰지 않고 새로 입력받는다
case "${1:-}" in
  --down)  fill_placeholder_secrets; log "컨테이너 중지"; $DC down; exit 0 ;;
  --logs)  fill_placeholder_secrets; exec $DC logs -f --tail=100 gateway auth-service tenant-service ;;
  --reset)
    fill_placeholder_secrets
    warn "컨테이너와 볼륨(DB 데이터)을 모두 삭제합니다."
    $DC down -v
    rm -f "$VAULT_FILE" # DB 를 지웠으니 보관해 둔 DB/Admin 비밀번호도 더는 맞지 않는다. DEK 는 남긴다.
    IGNORE_VAULT=1
    ;;
  --ask)   IGNORE_VAULT=1 ;;
  "") ;;
  *) die "알 수 없는 옵션: $1 (--reset | --ask | --down | --logs)" ;;
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

# ---------- 4. 비밀번호 입력 (평문 저장 안 함, 성공하면 암호화해 보관) ----------
DB_VOLUME="${COMPOSE_PROJECT_NAME}_db_data"
if docker volume inspect "$DB_VOLUME" >/dev/null 2>&1; then
  HAS_VOLUME=1
else
  HAS_VOLUME=0
fi

# 환경변수(HR_*)로 직접 준 값은 보관하지 않는다(CI 러너에 DEK/암호문이 만들어지는 걸 막는다). 보관하려면 ./scripts/vault.sh set.
USER_GIVEN_KEYS=""
for vk in DB_ROOT_PASSWORD DB_PASSWORD ADMIN_PASSWORD; do
  vname="HR_$vk"
  if [ -n "${!vname:-}" ]; then USER_GIVEN_KEYS="$USER_GIVEN_KEYS $vk"; fi
done

# 이전에 입력해 암호화해 둔 비밀번호가 있으면 다시 묻지 않고 쓴다. (--ask/--reset 이면 쓰지 않는다)
# 보관된 값이 지금의 비밀번호 규칙에 안 맞으면(예전 vault.sh 로 규칙 없이 넣은 값) 쓰지 않고 새로 입력받는다.
VAULT_LOADED_KEYS="" # 보관함에서 올린 키: 값이 그대로이므로 끝에서 다시 쓰지 않는다
vault_value_ok() { secret_invalid_reason "$1" 72; }
VAULT_VALIDATOR=vault_value_ok
if [ "$IGNORE_VAULT" = 0 ]; then
  if vault_available; then
    vault_export_presets DB_ROOT_PASSWORD DB_PASSWORD ADMIN_PASSWORD
    if [ "$VAULT_LOADED" -gt 0 ]; then
      log "암호화해 보관한 비밀번호 ${VAULT_LOADED}개를 사용합니다. (새로 입력하려면 ./scripts/init.sh --ask)"
    fi
    # 기존 볼륨 재실행에서는 root 비밀번호를 묻지도 쓰지도 않으므로 규칙 위반이어도 알릴 이유가 없다(매번 거짓 경고가 된다).
    if [ "$HAS_VOLUME" = 1 ]; then VAULT_REJECTED_KEYS="${VAULT_REJECTED_KEYS/DB_ROOT_PASSWORD/}"; fi
    # shellcheck disable=SC2086
    VAULT_REJECTED_KEYS="$(echo $VAULT_REJECTED_KEYS)" # 공백 정리
    if [ -n "$VAULT_REJECTED_KEYS" ]; then
      warn "보관된 ${VAULT_REJECTED_KEYS} 가 비밀번호 규칙에 맞지 않아 쓰지 않고 새로 입력받습니다. (입력값은 기동 후 새 값으로 보관합니다. 단 기존 DB 볼륨 재실행의 Admin 은 보관하지 않으니 ./scripts/vault.sh set ADMIN_PASSWORD)"
    fi
  elif [ -f "$VAULT_FILE" ]; then
    warn "보관해 둔 비밀번호(${VAULT_FILE})를 풀 수 없습니다. DEK(${DEK_FILE})를 잃었거나 파일이 손상됐을 수 있습니다. 새로 입력받습니다."
    warn "다시 보관하려면 먼저 ${VAULT_FILE} 를 삭제하세요. (지금은 보관에 실패하지만 기동에는 영향 없습니다)"
  fi
fi

if [ "$HAS_VOLUME" = 0 ]; then
  log "최초 구성: 비밀번호를 입력하세요. (${SECRET_MIN}자 이상, 화면에 표시되지 않고 평문으로는 저장되지 않습니다. 기동에 성공하면 암호화해 보관합니다)"
  prompt_secret DB_ROOT_PASSWORD "MariaDB root 비밀번호"
  prompt_secret DB_PASSWORD "MariaDB 서비스 계정(${DB_USER}_*) 비밀번호"
  prompt_secret ADMIN_PASSWORD "Admin(${ADMIN_EMAIL}) 로그인 비밀번호"
  warn "입력한 비밀번호는 기동에 성공하면 DEK 로 암호화해 .secrets.enc 에 보관합니다. 그래도 직접 기억해 두세요. (DEK: ${DEK_FILE})"
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
    # 값은 프로세스 인자(ps 에 보임)가 아니라 환경으로만 넘긴다: -e MYSQL_PWD (값 없이) 는 이 쉘의 환경에서 가져온다.
    if ! MYSQL_PWD="$DB_PASSWORD" $DC exec -T -e MYSQL_PWD db mariadb -u"${DB_USER}_auth" -e 'SELECT 1' >/dev/null 2>&1; then
      die "DB 비밀번호가 기존 구성과 다릅니다. 다시 입력하려면 ./scripts/init.sh --ask, 모르면 ./scripts/init.sh --reset (DB 데이터 삭제)"
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

# ---------- 7. 비밀번호 암호화 보관 ----------
# 기동에 성공한(= 맞는) 비밀번호만 DEK 로 암호화해 .secrets.enc 에 보관한다. 이미 기동은 끝났으므로 실패해도 경고만 한다.
# - 환경변수로 직접 준 값은 보관하지 않는다. 보관함에서 꺼내 쓴 값은 그대로이므로 다시 쓰지 않는다(매번 재암호화하지 않는다).
# - 기존 DB 볼륨으로 재실행한 경우 Admin 비밀번호는 쓰이지도 확인되지도 않으므로 보관하지 않는다(틀린 값을 맞는 값처럼 보관해
#   나중에 e2e 가 로그인 5회 제한에 걸리는 걸 막는다). 바꾸려면 ./scripts/vault.sh set ADMIN_PASSWORD.
SAVE_KEYS=""
for vk in DB_ROOT_PASSWORD DB_PASSWORD ADMIN_PASSWORD; do
  case " $USER_GIVEN_KEYS $VAULT_LOADED_KEYS " in *" $vk "*) continue ;; esac
  if [ "$HAS_VOLUME" = 1 ] && [ "$vk" = ADMIN_PASSWORD ]; then continue; fi
  SAVE_KEYS="$SAVE_KEYS $vk"
done
# shellcheck disable=SC2086
if vault_save_secrets $SAVE_KEYS; then
  if [ -n "$VAULT_SAVED" ]; then
    log "입력한 비밀번호를 암호화해 보관했습니다: ${VAULT_SAVED}  (암호문 ${VAULT_FILE}, DEK ${DEK_FILE})"
  fi
else
  warn "비밀번호를 암호화해 보관하지 못했습니다. (기동에는 영향 없음. 원인은 위 [vault] 메시지)"
fi

# 보관함에 Admin 비밀번호가 실제로 있을 때만 확인 방법을 안내한다(환경변수로 줬거나 기존 볼륨 재실행이면 없다).
ADMIN_NOTE="(init 중 입력한 비밀번호. 보관되지 않았음)"
case " $(vault_keys 2>/dev/null | tr '\n' ' ') " in
  *" ADMIN_PASSWORD "*) ADMIN_NOTE="(보관된 값 확인: ./scripts/vault.sh get ADMIN_PASSWORD)" ;;
esac

cat <<EOF

  ✅ 준비 완료

  Frontend : http://localhost:${FRONTEND_PORT}
  Gateway  : http://localhost:${GATEWAY_PORT}/api/health
  MariaDB  : localhost:${DB_PORT}  (db=${AUTH_DB_NAME},${TENANT_DB_NAME} user=${DB_USER}_auth,${DB_USER}_tenant)
  MQTT     : mqtt://localhost:${MQTT_PORT}
  Redis    : localhost:${REDIS_PORT}

  Admin 로그인: ${ADMIN_EMAIL} / ${ADMIN_NOTE}

  로그 보기   : ./scripts/init.sh --logs
  MQTT 구독   : mosquitto_sub -h localhost -p ${MQTT_PORT} -t 'hr/#' -v
  중지        : ./scripts/init.sh --down
  완전 초기화 : ./scripts/init.sh --reset
  화면 테스트 : ./scripts/e2e.sh
EOF
