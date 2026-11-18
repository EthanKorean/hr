#!/usr/bin/env python3
"""고객사(tenant) 테스트 데이터 생성기.

gateway API 로 로그인(RSA-4096 암호화)한 뒤 고객사를 등록한다.
사용기간을 다양하게 분산해 4가지 실효 상태(사용중/시작 예정/만료/정지)를 모두 만든다.

  python seed_tenants.py                 # 30건 생성
  python seed_tenants.py -n 100 --seed 7 # 100건, 난수 시드 지정
  python seed_tenants.py --clean         # 이 스크립트가 만든 [TEST] 고객사만 삭제

접속 정보 기본값은 프로젝트 루트 .env 에서 읽는다 (GATEWAY_PORT, ADMIN_EMAIL).
Admin 비밀번호는 어디에도 저장되지 않으므로 --password / ADMIN_PASSWORD 환경변수가 없으면 숨김 프롬프트로 입력받는다.
"""
from __future__ import annotations

import argparse
import base64
import getpass
import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

MAX_ATTEMPTS = 20
PREFIX = "[TEST] "  # --clean 이 이 접두사로 식별한다 (실데이터 보호)

ROOT = Path(__file__).resolve().parents[2]

NAME_A = ["한빛", "새론", "다온", "푸른", "미래", "가람", "하늘", "대흥", "서진", "온누리", "태성", "유진", "청솔", "나래", "동아"]
NAME_B = ["전자", "물류", "건설", "식품", "소프트", "테크", "정밀", "산업", "시스템즈", "제약", "에너지", "푸드", "모빌리티", "로보틱스"]
SUFFIX = ["", "", "", "(주)", " 주식회사", " Inc."]
SURNAMES = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권"]
GIVEN = ["민준", "서연", "도윤", "지우", "하준", "서윤", "지호", "수아", "예준", "지민", "현우", "유나", "준서", "채원"]


# ---------------------------------------------------------------- 설정
def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k] = v
    return env


# ---------------------------------------------------------------- HTTP
class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.token: str | None = None

    def call(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict | None]:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                raw = r.read()
                try:
                    return r.status, (json.loads(raw) if raw else None)
                except ValueError:  # 2xx 인데 JSON 이 아닌 응답(프록시 오류 페이지 등)
                    return r.status, {"error": raw.decode(errors="replace")}
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw) if raw else None
            except ValueError:
                return e.code, {"error": raw.decode(errors="replace")}
        except urllib.error.URLError as e:  # 연결 거부/연결 타임아웃 등
            sys.exit(f"연결 실패: {self.base} ({e.reason}) - 스택이 떠 있는지 확인하세요.")
        except OSError as e:  # 응답 읽기 중 타임아웃/연결 끊김은 URLError 로 감싸지지 않는다
            sys.exit(f"요청 실패: {self.base}{path} ({e})")

    def login(self, email: str, password: str) -> None:
        st, key = self.call("GET", "/api/auth/public-key")
        if st != 200 or not key:
            sys.exit(f"공개키 조회 실패 ({st}) - 스택이 떠 있는지 확인하세요: {self.base}")
        pub = serialization.load_der_public_key(base64.b64decode(key["publicKey"]))
        skew_ms = key.get("serverTime", time.time() * 1000) - time.time() * 1000  # 로컬 시계 오차 보정
        # 프론트(crypto.ts)와 동일한 평문 포맷: {p, t(epoch ms), n(1회용 nonce)}
        plain = json.dumps({"p": password, "t": int(time.time() * 1000 + skew_ms), "n": str(uuid.uuid4())}).encode()
        cipher = pub.encrypt(
            plain,
            padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
        )
        st, res = self.call("POST", "/api/admin/auth/login", {"email": email, "encryptedPassword": base64.b64encode(cipher).decode()})
        if st != 200 or not res:
            sys.exit(f"로그인 실패 ({st}): {res and res.get('error')}")
        self.token = res["token"]


# ---------------------------------------------------------------- 데이터 생성
def biz_no(rng: random.Random) -> str:
    return f"{rng.randint(100, 999)}-{rng.randint(10, 99)}-{rng.randint(10000, 99999)}"


def make_tenant(rng: random.Random, today: date, kind: str) -> dict:
    """kind: active | scheduled | expired | suspended"""
    if kind == "active":
        start = today - timedelta(days=rng.randint(10, 500))
        end = today + timedelta(days=rng.randint(5, 700))  # 일부는 곧 만료(5일~)
        status = "active"
    elif kind == "scheduled":
        start = today + timedelta(days=rng.randint(3, 120))
        end = start + timedelta(days=rng.randint(180, 730))
        status = "active"
    elif kind == "expired":
        end = today - timedelta(days=rng.randint(1, 400))
        start = end - timedelta(days=rng.randint(90, 730))
        status = "active"
    else:  # suspended: 기간은 유효하지만 수동 정지
        start = today - timedelta(days=rng.randint(10, 300))
        end = today + timedelta(days=rng.randint(30, 400))
        status = "suspended"

    name = f"{PREFIX}{rng.choice(NAME_A)}{rng.choice(NAME_B)}{rng.choice(SUFFIX)}"
    contact = rng.choice(SURNAMES) + rng.choice(GIVEN)
    n = rng.randint(1000, 9999)
    return {
        "name": name,
        "bizNo": biz_no(rng),
        "contactName": contact,
        "contactEmail": f"user{n}@example.com",
        "contactPhone": f"010-{rng.randint(1000, 9999)}-{rng.randint(1000, 9999)}",
        "maxEmployees": rng.choice([5, 10, 30, 50, 100, 300, 1000]),
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "status": status,
    }


ALL_KINDS = ["active", "scheduled", "expired", "suspended"]
# 상태 분포: 사용중 55% / 시작 예정 15% / 만료 20% / 정지 10%
KINDS = ["active"] * 11 + ["scheduled"] * 3 + ["expired"] * 4 + ["suspended"] * 2


def seed(api: Api, count: int, rng: random.Random) -> None:
    today = date.today()
    created: Counter[str] = Counter()
    skipped = failed = 0
    for i in range(count):
        # 처음 4건은 4가지 상태를 하나씩 보장(적은 건수에서도 모든 상태 확인 가능), 이후는 가중 무작위
        kind = ALL_KINDS[i] if i < len(ALL_KINDS) else rng.choice(KINDS)
        for _attempt in range(MAX_ATTEMPTS):  # 사업자번호 중복(409) 시 재생성
            body = make_tenant(rng, today, kind)
            st, res = api.call("POST", "/api/admin/tenants", body)
            if st == 201 and res:
                created[res["effectiveStatus"]] += 1
                break
            if st == 409:
                skipped += 1
                continue
            failed += 1
            print(f"  ! 실패 ({st}): {res and res.get('error')} / {body['name']}", file=sys.stderr)
            break
        else:  # 재시도를 모두 소진 -> 조용히 누락시키지 않고 실패로 집계
            failed += 1
            print(f"  ! {MAX_ATTEMPTS}회 재시도 후에도 사업자번호가 중복됩니다 (--seed 를 바꿔보세요)", file=sys.stderr)
    total = sum(created.values())
    print(f"생성 {total}건 (요청 {count}건, 중복 재시도 {skipped}회, 실패 {failed}건)")
    for k in ("active", "scheduled", "expired", "suspended"):
        print(f"  {k:<10} {created[k]}")
    if failed:
        sys.exit(1)


def clean(api: Api) -> None:
    st, items = api.call("GET", "/api/admin/tenants?q=" + urllib.parse.quote(PREFIX.strip()))
    if st != 200 or items is None:
        sys.exit(f"목록 조회 실패 ({st})")
    targets = [t for t in items if t["name"].startswith(PREFIX)]
    for t in targets:
        st, _ = api.call("DELETE", f"/api/admin/tenants/{t['id']}")
        if st != 204:
            sys.exit(f"삭제 실패 id={t['id']} ({st})")
    print(f"{PREFIX.strip()} 고객사 {len(targets)}건 삭제 (접두사가 다른 고객사는 건드리지 않음)")


def main() -> None:
    env = {**load_env(ROOT / ".env"), **os.environ}
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-n", "--count", type=int, default=30)
    ap.add_argument("--seed", type=int, default=None, help="난수 시드(재현용). 생략하면 매번 다른 데이터")
    ap.add_argument("--clean", action="store_true", help="[TEST] 접두사 고객사만 삭제하고 종료")
    ap.add_argument("--base-url", default=f"http://localhost:{env.get('GATEWAY_PORT', '8001')}")
    ap.add_argument("--email", default=env.get("ADMIN_EMAIL"))
    ap.add_argument("--password", default=os.environ.get("ADMIN_PASSWORD"), help="생략 시 ADMIN_PASSWORD 환경변수, 그것도 없으면 프롬프트")
    a = ap.parse_args()
    if not a.email:
        sys.exit("ADMIN_EMAIL 을 .env 또는 --email 로 지정하세요.")
    if not a.password:
        if not sys.stdin.isatty():
            sys.exit("Admin 비밀번호가 필요합니다: ADMIN_PASSWORD 환경변수 또는 --password (대화형이면 프롬프트)")
        a.password = getpass.getpass(f"Admin 비밀번호 ({a.email}): ")

    api = Api(a.base_url)
    api.login(a.email, a.password)
    if a.clean:
        clean(api)
    else:
        seed(api, a.count, random.Random(a.seed))


if __name__ == "__main__":
    main()
