# HR 프로젝트 규칙

Node.js + TypeScript + React + MariaDB + Redis + MQTT 스터디 프로젝트. MSA + 헥사고날 아키텍처, 전부 Docker. 구조와 API 는 README 참고.

## 환경
- 포트는 모두 8000번대다 (frontend 8000, gateway 8001, MariaDB 8002, Redis 8003, MQTT 8004). 호스트 포트는 전부 127.0.0.1 에만 바인드하고, 내부 서비스(auth, tenant)는 포트를 열지 않는다.
- Linux 와 macOS 둘 다 `./scripts/init.sh` 가 처리한다. macOS 에서 docker 는 colima(`colima start`) 또는 Docker Desktop. compose 는 `docker compose` 플러그인이 없으면 독립 실행형 `docker-compose` 를 쓴다(init.sh 가 고른다).
- 로그인(WebCrypto)은 `localhost` 또는 https 에서만 동작한다. `http://localhost:8000` 으로 접속한다.

## 프로젝트 셋팅 ("프로젝트 구성 셋팅해줘" / "실행해줘")
1. docker 데몬(`docker info`), 포트 8000~8004 가 비어 있는지, 이미 만든 `hr` 컨테이너/볼륨이 있는지 확인한다.
2. **비밀번호(MariaDB root, 서비스 계정, Admin)는 절대 임의로 정하지 않는다.** 처음이면 사용자가 직접 `! ./scripts/init.sh` 로 입력하게 한다(숨김 입력). 입력값은 기동에 성공하면 DEK 로 암호화돼 `.secrets.enc` 에 보관되므로, 이후 재실행(`./scripts/init.sh`)은 묻지 않는다. 환경변수(`HR_DB_ROOT_PASSWORD` 등)로 받는 방법은 값이 대화에 남으므로 권하지 않는다.
3. 보관된 비밀번호가 있으면(`./scripts/vault.sh list`) 재실행은 그냥 `./scripts/init.sh` 를 실행하면 된다. 새로 입력받으려면 `--ask`.
4. `--reset` 은 DB 데이터와 보관한 비밀번호를 모두 지우므로 반드시 사용자에게 먼저 확인한다. DEK(`~/.config/hr/dek.key`)를 잃으면 암호문을 풀 수 없다(init 이 알리고 새로 입력받는다. 다시 보관하려면 `.secrets.enc` 삭제, DB 비밀번호를 모르면 `--reset`).
5. 기동 후 `http://localhost:8000` 과 서비스 상태를 확인하고, 결과(된 것, 건너뛴 것, 사용자가 할 것)를 정리해서 알린다.

## 비밀번호 보관함(vault) 사용 규칙
- 구조: 암호문 `.secrets.enc`(git 제외) + 저장소 밖 DEK. 모듈은 `scripts/lib/vault.sh`, 명령은 `scripts/vault.sh`, 시험은 `scripts/test-vault.sh`. 자세한 설명은 README 의 "비밀번호" 절.
- 보관된 값은 `./scripts/init.sh` 재실행과 **로컬 개발용 테스트**(`./scripts/e2e.sh`, seed 등)에서만 스크립트가 읽게 한다. 값을 출력하거나 로그·대화·커밋에 남기지 않는다(`vault.sh get` 결과를 그대로 보여 주지 않고 환경변수로만 넘긴다). 값이 필요 없는 확인은 `vault.sh list` 로 한다.
- `.secrets.enc` 와 DEK 파일(`~/.config/hr/dek.key`)은 내용을 읽어 보여 주거나 복사·이동하지 않는다. 운영용 비밀은 넣지 않는다.
- DEK 가 노출되면 소용없다는 한계는 의도적으로 감수한 것이다. 보안 장치를 더 얹어 설계를 복잡하게 만들지 않는다.
- `scripts/lib/vault.sh` 를 고치면 `./scripts/test-vault.sh` 를 기본 bash 와 `/bin/bash`(macOS 3.2) 둘 다로 돌려 모두 통과하는지 확인한다.

## 구조 규칙
- 의존 방향은 항상 adapters → application → domain 이다. domain 은 프레임워크·DB 를 모른다.
- 서비스는 자기 DB 스키마(`hr_auth`, `hr_tenant`)만 접근한다. 서비스 간 코드 공유는 하지 않고(`env`, 마이그레이션 러너 등은 서비스마다 복제), 필요한 건 gateway/MQTT 로 주고받는다.
- 보안 장치(로그인 RSA 암호화, 시도 제한, 로그아웃 무효화, `x-internal-key` 위조 차단)를 약화하지 않는다. README 의 "알려진 한계"는 스터디 범위에서 의도적으로 받아들인 것이다.
- DB 스키마 변경은 마이그레이션 파일(`services/*/migrations`)로 한다. 새 마이그레이션은 서비스를 재시작해야 적용된다.

## 검증
- 타입: 각 서비스와 `frontend` 에서 `npm run typecheck`.
- 도메인 단위 테스트: `cd services/tenant && npm test` (DB 없이 실행). 도메인 규칙을 바꾸면 테스트를 함께 고친다.
- 화면은 Playwright(`e2e/`)로 검증한다. 빌드·타입 검사만으로 끝내지 않는다. `./scripts/e2e.sh` 가 보관함의 Admin 비밀번호를 읽어 실행한다. 모양을 바꿨으면 스크린샷을 열어 직접 본다.
- 로그인은 IP+이메일 10분 내 5회까지다. Admin 계정으로 틀린 비밀번호를 반복해 시도하지 않는다(잠긴다).

## 커밋
- 커밋/푸시는 사용자가 요청할 때만 한다.
- 메시지는 `feat:` / `fix:` / `docs:` / `chore:` 중 하나로 시작한다. 잘게 쪼개지 않고 한 작업은 큰 범주 하나로 묶는다. `Co-Authored-By` 줄은 넣지 않는다.
