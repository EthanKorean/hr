const env = (k: string, d?: string): string => {
  const v = process.env[k] ?? d;
  // 빈 문자열도 누락으로 본다. (compose 의 ${VAR} 는 미설정 시 '' 가 되어, 빈 INTERNAL_KEY/JWT_SECRET 로 기동되는 것을 막는다)
  if (!v) throw new Error(`환경변수 ${k} 가 필요합니다.`);
  return v;
};

export const config = {
  port: Number(env('PORT', '3001')),
  db: {
    host: env('DB_HOST', 'localhost'),
    port: Number(env('DB_PORT', '3306')),
    database: env('DB_NAME'),
    user: env('DB_USER'),
    password: env('DB_PASSWORD'),
  },
  redisUrl: env('REDIS_URL', 'redis://localhost:6379'),
  jwtSecret: env('JWT_SECRET'),
  internalKey: env('INTERNAL_KEY'),
  // 신뢰할 프록시 홉 수. 기본 1 = gateway 만. gateway 앞에 LB/리버스 프록시를 두면 그 수만큼 늘린다.
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS || 1),
  adminEmail: env('ADMIN_EMAIL'),
  // 최초 기동(admin 이 없을 때)에만 필요. init.sh 는 DB 볼륨이 이미 있으면 admin 비밀번호를 다시 묻지 않고 비워 둔다.
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
};
