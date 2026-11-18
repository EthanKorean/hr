# HR (스터디 프로젝트)

Node.js + TypeScript + React + MariaDB + Redis + MQTT, 전부 Docker. **MSA + 헥사고날 아키텍처**.

```
 browser ─▶ frontend(8000) ─/api─▶ gateway(8001) ─┬─▶ auth-service   ─▶ MariaDB(hr_auth) + Redis
                                                  └─▶ tenant-service ─▶ MariaDB(hr_tenant) ─▶ MQTT(8004)
```

| 컴포넌트 | 역할 | 호스트 포트 |
|---|---|---|
| frontend | React + Vite (TS) | 8000 |
| gateway | 라우팅, JWT 검증 위임, 내부 헤더 위조 차단 | 8001 |
| auth-service | Admin 로그인 / JWT / 로그아웃 무효화 / RSA 복호화 / 로그인 시도 제한 | (내부) |
| tenant-service | 고객사 + 사용기간 | (내부) |
| db / redis / mqtt | MariaDB 11 / Redis 7 / Mosquitto 2 | 8002 / 8003 / 8004 |

내부 서비스는 호스트에 포트를 열지 않고 gateway 만 노출된다. 모든 호스트 포트(frontend/gateway/db/redis/mqtt)는 개발 편의상 127.0.0.1 에만 바인드한다(WebCrypto 때문에 어차피 localhost 접속만 로그인 가능). 서비스는 자기 DB 스키마만 접근한다.

## 시작

```bash
./scripts/init.sh          # .env(비밀 아닌 설정) 준비 + 비밀번호 입력 + 빌드 + 기동 + 헬스체크
./scripts/init.sh --reset  # 볼륨 포함 전부 삭제 후 재시작 (DB 스키마 분리 초기화는 빈 볼륨에서만 실행됨)
./scripts/init.sh --down   # 중지
./scripts/init.sh --logs   # 서비스 로그
```

Linux / macOS(Docker Desktop, OrbStack, Colima) 겸용. 필요한 건 docker, openssl, curl 뿐.

### 비밀번호 (저장되지 않음)

최초 실행 시 **MariaDB root / MariaDB 서비스 계정 / Admin** 비밀번호를 숨김 입력으로 받는다(8자 이상, 출력 가능한 ASCII, `' " \ $` 백틱 공백 제외).
입력 로직은 `scripts/lib/secrets.sh`. 비밀번호는 **어떤 파일에도 쓰지 않고** init.sh 프로세스의 환경변수로만 `docker compose` 에 전달한다.
`.env` 에는 포트/DB 이름 같은 비밀이 아닌 설정만 있다. `JWT_SECRET`·`INTERNAL_KEY` 는 실행할 때마다 메모리에서 새로 만든다(재실행하면 로그인 토큰 무효).

- **재실행:** DB 볼륨이 이미 있으면 **DB 비밀번호만** 다시 묻는다(root/Admin 은 최초 초기화에만 쓰이므로). 틀리면 기동 전에 거부한다. 모르면 `--reset`(데이터 삭제).
- **Admin 비밀번호:** 최초 구성 때만 사용된다. 직접 보관할 것. 잊었으면 `--reset`.
- **비대화형(CI):** `HR_DB_ROOT_PASSWORD`, `HR_DB_PASSWORD`, `HR_ADMIN_PASSWORD` 환경변수로 미리 주면 프롬프트를 건너뛴다.
- **이전 버전 `.env`:** 비밀 항목이 남아 있으면 init 이 자동으로 제거한다.
- 주의: 컨테이너가 실행되는 동안 값은 컨테이너 환경에 존재한다(`docker inspect` 로 보임). 프로젝트 파일/쉘 히스토리에는 남지 않는다.

> rootless podman 환경에서 docker 소켓 권한/BuildKit 오류가 나면:
> `DOCKER_HOST=unix:///run/user/$UID/podman/podman.sock COMPOSE_DOCKER_CLI_BUILD=0 DOCKER_BUILDKIT=0 ./scripts/init.sh`

## 헥사고날 구조 (서비스 공통)

```
services/<svc>/src/
  domain/                순수 도메인 규칙 (프레임워크/DB 의존 없음)
  application/
    ports.ts             application 이 외부에 요구하는 계약(인터페이스)
    *-service.ts         유스케이스. 포트에만 의존
  adapters/
    in/http/             Express 라우터 (입력 검증, 에러 -> HTTP 상태 매핑)
    out/<tech>/          MySQL, Redis, MQTT, bcrypt/JWT/RSA 등 포트 구현체
  main.ts                조립(composition root): 구현체를 골라 주입
```

의존 방향은 항상 adapters → application → domain. 예) `TenantService` 는 `TenantRepository`/`EventPublisher`/`Clock`
인터페이스만 알고, MySQL·MQTT 는 모른다. (도메인 규칙은 DB 없이 단위 테스트 가능)

## 도메인

- **Admin**: 시스템 운영자 (auth-service).
- **고객사(tenant)**: 사용기간(시작/종료일), 최대 근로자 수, 수동 정지. 실효 상태 = `suspended` > `expired` > `scheduled` > `active`.
  연장은 현재 종료일(이미 만료면 오늘) 기준 N개월, 말일 보정(1/31 + 1개월 = 2/28).
- (예정) 고객사 관리자 / 근로자 → worker-service 로 추가, `tenant_id` 로 고객사 참조.

## API (gateway 경유, `Authorization: Bearer <token>`)

| | |
|---|---|
| `GET /api/auth/public-key` | 로그인 암호화용 RSA 공개키 |
| `POST /api/admin/auth/login` / `logout` | `{email, encryptedPassword}` / 토큰 무효화 |
| `GET/POST /api/admin/tenants` | 목록(`?q=`) / 등록 |
| `GET/PUT/DELETE /api/admin/tenants/:id` | 조회 / 수정 / 삭제 |
| `POST /api/admin/tenants/:id/extend` | `{months}` 연장 |

## 보안

- **로그인 비밀번호 RSA-4096 암호화**(RSA-OAEP SHA-256): 평문 `{비밀번호, 타임스탬프(±60초), 1회용 nonce}`.
  nonce 는 Redis 에 기록해 재전송 차단. 개인키는 auth-service 메모리에만 존재(재시작 시 교체).
  모든 로그인(Admin/고객사)이 같은 `RsaPasswordDecryptor` 를 재사용.
  한계: TLS 를 대체하지 않음(운영은 HTTPS 필수). WebCrypto 제약으로 `https://` 또는 `localhost` 에서만 동작.
- **로그인 시도 제한**: IP+이메일 10분 내 **로그인 시도 5회**(성공 여부와 무관하게 비밀번호 검증 전에 원자적으로 카운트) → 429 (Redis). 성공하면 카운터 초기화.
- **로그아웃 무효화**: JWT `jti` 를 남은 수명만큼 Redis 블랙리스트.
- **서비스 간 신뢰**: gateway 가 외부의 `x-internal-key`/`x-admin-id` 를 제거하고, 토큰 검증 후 `INTERNAL_KEY` 를 붙여 전달.
  내부 서비스는 이 키가 없으면 403.
- Redis 장애 시 위 Redis 기반 검사는 fail-open (스터디용). 운영은 fail-closed 검토.

## 알려진 한계 (스터디 범위에서 의도적으로 받아들인 것)

- **클라이언트 IP:** 로그인 시도 제한 키는 `IP+이메일` 이지만, 컨테이너 포트 포워딩(rootless podman, macOS Docker Desktop)은
  실제 클라이언트 IP 를 전달하지 않아 개발 환경에서는 사실상 이메일 단위로 동작한다(공격자가 admin 계정을 일시 잠글 수 있음).
  운영에서는 gateway 앞에 `X-Forwarded-For` 를 붙이는 리버스 프록시/LB 를 두고 `trust proxy` 홉 수를 맞출 것.
- **개발 프록시 구간의 클라이언트 IP:** 브라우저 → Vite 프록시 → gateway 구성에서 Vite 프록시가 `X-Forwarded-For` 를 붙이지 않아 gateway 는 Vite 컨테이너 IP 만 본다. 위 포트 포워딩 한계와 합쳐 로그인 제한은 개발 환경에서 사실상 이메일 단위다.
- **로그인 시도 카운트 시점:** 비밀번호 검증 전에 카운트하므로 임의의 요청 6회로 admin 계정을 10분간 잠글 수 있다(개발 환경에선 IP 구분도 불가). 운영에선 계정 잠금 대신 IP 단위 제한/CAPTCHA 와 함께 설계할 것.
- **로그아웃 실패 은닉:** 서버가 토큰을 무효화하지 못해도(Redis 장애 등) UI 는 로컬 토큰만 지우고 로그인 화면으로 돌아간다. 이미 복사된 토큰은 최대 12시간 유효.
- **마이그레이션 부분 실패 복구:** 다중 문장 마이그레이션이 중간에 실패하면 재시작 시 같은 문장을 다시 실행해 crash-loop 한다(DDL 은 롤백 불가). `IF NOT EXISTS` 로 멱등하게 쓰거나 수동 복구가 필요하다. 또 `.sql` 추가/수정은 hot reload 대상이 아니며 서비스 재시작 때 적용된다.
- **Redis 무인증:** 토큰 폐기/nonce/로그인 제한 상태를 담는 Redis 에 비밀번호가 없다(127.0.0.1 바인드만으로 보호). 운영에선 `requirepass`/ACL + 네트워크 분리 필요.
- **Redis fail-open:** Redis 장애 시 로그인 제한/nonce 검사를 건너뛰고, 이미 로그아웃된 토큰이 다시 유효해질 수 있다. 로그아웃은 Redis 오류 시 500.
- **MQTT 이벤트:** 연결이 끊긴 동안은 mqtt.js 메모리 큐에만 보관(프로세스 재시작 시 유실). 영속 outbox 는 worker-service 도입 시 검토.
- **서비스별 코드 중복:** `env`/마이그레이션 러너/`ah` 래퍼는 서비스 독립성을 위해 서비스마다 복제한다(공용 패키지는 빌드·배포 결합이 생김).
- **마이그레이션 러너:** `;` + 개행 단위 단순 분리, 파일 단위 트랜잭션 없음. 마이그레이션 SQL 에 세미콜론이 든 문자열/프로시저를 쓰지 말 것.
- **MQTT 익명 브로커 + 연락처 PII:** 이벤트에 고객사 담당자 연락처가 포함되고 브로커는 익명 허용이다. 포트를 127.0.0.1 에만 바인드해 두었으며, 운영에서는 인증/TLS 와 이벤트 페이로드 최소화가 필요하다.
- **MQTT 오프라인 큐 무제한/에러 미관측:** 브로커가 오래 죽어 있으면 메모리 큐가 계속 쌓이고 발행 실패를 로깅하지 않는다.
- **토큰 저장 위치:** JWT 를 `localStorage` 에 보관한다(XSS 에 노출, CSP 미적용). 운영에서는 httpOnly SameSite 쿠키 + CSP 를 권장.
- **시계 오차:** 로그인 타임스탬프 검증(±60초)은 서버 시각을 공개키 응답으로 받아 보정하므로, 클라이언트 시계가 틀려도 동작한다.
- **JWT 재검사 없음:** 토큰 검증은 서명·만료·블랙리스트만 본다. admin 삭제/비밀번호 변경은 기존 토큰(최대 12시간)에 즉시 반영되지 않는다.
- **RSA 복호화는 동기 연산:** 로그인 엔드포인트에서 이벤트 루프를 잠깐 점유한다(요청 수 제한은 gateway/LB 에서 처리). 비밀번호는 최대 72바이트(bcrypt 가 72바이트 이후를 무시하므로 상한을 일치시킴).
- **목록 페이지네이션 없음:** 고객사 목록/검색은 전체 조회(스터디 데이터 규모 가정).
- **dev 컨테이너:** 소스 바인드 마운트 + `tsx watch`/Vite dev 서버로 실행(운영 빌드 아님). 개발 중 auth-service 재시작마다 RSA 키가 교체되어 열려 있던 로그인 화면은 1회 재시도가 필요하다.

## MQTT

tenant-service 가 `hr/tenants/<id>/{created|updated|extended|deleted}` 로 JSON 이벤트 발행.

```bash
mosquitto_sub -h localhost -p 8004 -t 'hr/#' -v
```

## 테스트 데이터 (Python)

`tools/seed/seed_tenants.py` 가 gateway API 로 로그인(RSA-4096 암호화 포함)한 뒤 고객사를 등록한다.
사용중 / 시작 예정 / 만료 / 정지 4가지 상태가 골고루 나오며(첫 4건은 상태별 1건씩 보장), 이름은 `[TEST]` 로 시작한다.

```bash
pip install -r tools/seed/requirements.txt      # cryptography 만 필요 (표준 라이브러리 HTTP)
python3 tools/seed/seed_tenants.py              # 30건
python3 tools/seed/seed_tenants.py -n 100 --seed 7   # 건수 / 난수 시드(재현용)
python3 tools/seed/seed_tenants.py --clean      # [TEST] 고객사만 삭제 (다른 데이터는 유지)
```

접속 정보는 루트 `.env` (GATEWAY_PORT, ADMIN_EMAIL)에서 읽고, `--base-url/--email/--password` 로 덮어쓸 수 있다.
Admin 비밀번호는 저장되지 않으므로 `--password` 나 `ADMIN_PASSWORD` 환경변수로 주거나, 없으면 숨김 프롬프트로 입력받는다.

## E2E (Playwright)

프론트 화면은 Playwright 로 검증한다 (로그인 암호화, 에러 표시, 등록/중복/수정/연장/검색/삭제/로그아웃, 429).

```bash
cd e2e && npm install && npx playwright install chromium   # 브라우저는 최초 1회만
set -a; . ../.env; set +a           # 포트/ADMIN_EMAIL 등 비밀 아닌 설정
read -rs -p 'Admin 비밀번호: ' ADMIN_PASSWORD; export ADMIN_PASSWORD; echo
npx playwright test
```
