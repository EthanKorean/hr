#!/usr/bin/env bash
# 비밀번호/시크릿 입력 모듈 (scripts/init.sh 가 source 한다).
#
# 원칙: 비밀번호는 어떤 파일에도 저장하지 않는다. 숨김 입력(read -s)으로 받아 이 프로세스의
# 환경변수로만 보관하고, `docker compose` 에 환경으로 전달한다. (.env 에는 포트/DB 이름 같은 비밀 아닌 설정만 둔다)
# 비대화형(CI)에서는 HR_<이름> 환경변수(예: HR_DB_PASSWORD)가 있으면 프롬프트 없이 그 값을 쓴다.
# macOS 기본 bash 3.2 호환.

SECRET_MIN=8
SECRET_KEYS="DB_ROOT_PASSWORD DB_PASSWORD ADMIN_PASSWORD JWT_SECRET INTERNAL_KEY"

# 길이/문자 검증. DB 초기화 SQL 과 쉘에 그대로 전개되므로 ' " \ $ ` 공백은 허용하지 않는다.
# 실패 시 사유를 stdout 으로 출력하고 1 반환.
secret_invalid_reason() { # value maxbytes
  local v="$1" max="$2" bytes
  bytes="$(printf '%s' "$v" | wc -c | tr -d ' ')"
  if [ "$bytes" -lt "$SECRET_MIN" ]; then echo "${SECRET_MIN}자 이상이어야 합니다."; return 1; fi
  if [ "$bytes" -gt "$max" ]; then echo "최대 ${max}바이트까지 가능합니다."; return 1; fi
  # DB 초기화 SQL/쉘 인코딩 문제를 피하기 위해 출력 가능한 ASCII 만 허용
  if printf '%s' "$v" | LC_ALL=C grep -q '[^ -~]'; then echo "영문/숫자/기호(ASCII)만 사용할 수 있습니다."; return 1; fi
  case "$v" in
    *[\'\"\\\$\`\ ]*) echo "작은따옴표 ' 큰따옴표 \" 역슬래시 \\ 달러 \$ 백틱 \` 공백은 사용할 수 없습니다."; return 1 ;;
  esac
  return 0
}

# prompt_secret VAR "설명" [확인재입력:1|0] [최대바이트:72] [optional]  (optional: 빈 입력 허용 -> VAR="")
prompt_secret() {
  local var="$1" label="$2" confirm="${3:-1}" max="${4:-72}" optional="${5:-}" preset_name="HR_$1" a b reason
  if [ -n "${!preset_name:-}" ]; then # 비대화형: 환경변수로 미리 지정된 값
    a="${!preset_name}"
    reason="$(secret_invalid_reason "$a" "$max")" || die "${preset_name}: ${reason}"
    export "$var=$a"
    return 0
  fi
  while :; do
    printf '  %s: ' "$label" >&2
    if ! IFS= read -r -s a; then # EOF(비대화형). 선택 입력이면 빈 값으로 처리하고, 필수면 환경변수로 받도록 안내한다.
      echo >&2
      if [ "$optional" = optional ]; then export "$var="; return 0; fi
      die "입력을 받을 수 없습니다. 비대화형이면 ${preset_name} 환경변수로 전달하세요."
    fi
    echo >&2
    if [ -z "$a" ] && [ "$optional" = optional ]; then export "$var="; return 0; fi
    if reason="$(secret_invalid_reason "$a" "$max")"; then :; else warn "$reason"; continue; fi
    if [ "$confirm" = 1 ]; then
      printf '  %s (확인): ' "$label" >&2
      IFS= read -r -s b || { echo >&2; die "입력을 받을 수 없습니다."; }
      echo >&2
      [ "$a" = "$b" ] || { warn "두 입력이 다릅니다. 다시 입력하세요."; continue; }
    fi
    export "$var=$a"
    return 0
  done
}

# 매 실행마다 메모리에서만 만드는 값 (저장하지 않음). 재실행하면 바뀌며, 기존 로그인 토큰은 무효가 된다.
gen_hex() { openssl rand -hex "$1"; }

# --down/--reset/--logs 처럼 값이 쓰이지 않는 compose 명령이 "변수 미설정" 경고를 내지 않도록 자리표시 값을 채운다.
fill_placeholder_secrets() {
  local k
  for k in $SECRET_KEYS; do export "$k=placeholder-unused"; done
}

# .env 에 (이전 버전이 저장해 둔) 비밀 항목이 있으면 제거한다. 값은 이번 실행의 기본값으로만 쓰이도록 반환하지 않고 삭제만 한다.
scrub_env_secrets() { # file
  local f="$1" k removed="" tmp
  for k in $SECRET_KEYS; do
    if grep -q "^${k}=" "$f"; then removed="$removed $k"; fi
  done
  [ -z "$removed" ] && return 0
  tmp="$(mktemp)"
  grep -v -E "^($(echo $SECRET_KEYS | tr ' ' '|'))=" "$f" > "$tmp" || true
  cat "$tmp" > "$f"; rm -f "$tmp"
  warn ".env 에 저장돼 있던 비밀 항목을 제거했습니다:${removed}"
  warn "기존 DB 볼륨은 이전 비밀번호로 만들어졌으므로, 그 값을 모르면 ./scripts/init.sh --reset 으로 다시 구성하세요."
}
