const env = (k: string, d?: string): string => {
  const v = process.env[k] ?? d;
  // 빈 문자열도 누락으로 본다. (compose 의 ${VAR} 는 미설정 시 '' 가 되어, 빈 INTERNAL_KEY 로 기동되면 내부 키 검사가 무력화된다)
  if (!v) throw new Error(`환경변수 ${k} 가 필요합니다.`);
  return v;
};

export const config = {
  port: Number(env('PORT', '3002')),
  db: {
    host: env('DB_HOST', 'localhost'),
    port: Number(env('DB_PORT', '3306')),
    database: env('DB_NAME'),
    user: env('DB_USER'),
    password: env('DB_PASSWORD'),
  },
  mqttUrl: env('MQTT_URL', 'mqtt://localhost:1883'),
  internalKey: env('INTERNAL_KEY'),
};
