const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));

/**
 * 서버의 RSA-4096 공개키로 비밀번호를 RSA-OAEP(SHA-256) 암호화한다. (모든 로그인 공용)
 * 평문에 타임스탬프 + 1회용 nonce 를 넣어 재전송 공격을 막는다.
 * WebCrypto 는 보안 컨텍스트(HTTPS 또는 localhost)에서만 동작한다.
 */
export async function encryptPassword(password: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('암호화를 사용할 수 없습니다. HTTPS 또는 localhost 로 접속하세요.');
  }
  // 네트워크 요청 전에 입력부터 검증한다.
  if (new TextEncoder().encode(password).length > 72) throw new Error('비밀번호가 너무 깁니다. (최대 72바이트)');
  const build = (t: number) => new TextEncoder().encode(JSON.stringify({ p: password, t: Math.round(t), n: crypto.randomUUID() }));
  // 길이 검사는 임시 타임스탬프로 먼저 한다(타임스탬프 자릿수가 같아 크기가 동일). 전송용 페이로드는 시계 보정 후에 만든다.
  const probe = build(Date.now());
  // RSA-4096 OAEP(SHA-256) 한 번에 암호화할 수 있는 최대 평문 = 512 - 2*32 - 2 = 446바이트.
  // JSON 이스케이프(따옴표/역슬래시/제어문자)로 평문이 비밀번호보다 훨씬 길어질 수 있어 페이로드 기준으로도 확인한다.
  if (probe.length > 446) throw new Error('비밀번호가 너무 깁니다. (특수문자는 이스케이프로 길이가 늘어납니다)');

  const t0 = Date.now();
  const res = await fetch('/api/auth/public-key');
  if (!res.ok) throw new Error('공개키를 가져오지 못했습니다.');
  const { publicKey, serverTime } = (await res.json()) as { publicKey: string; serverTime: number };
  // 브라우저 시계가 서버와 어긋나 있어도(±60초 검증) 로그인되도록, 서버 시각 기준 오프셋을 적용한다.
  const skew = serverTime - (t0 + Date.now()) / 2;

  const key = await crypto.subtle.importKey(
    'spki',
    b64ToBytes(publicKey),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
  const cipher = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, build(Date.now() + skew));
  return bytesToB64(cipher);
}
