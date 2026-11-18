import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config.js';
import { TenantService } from './application/tenant-service.js';
import { MysqlTenantRepository } from './adapters/out/mysql/tenant-repository.js';
import { migrate } from './adapters/out/mysql/pool.js';
import { MqttEventPublisher } from './adapters/out/mqtt/mqtt-event-publisher.js';
import { SystemClock } from './adapters/out/system/system-clock.js';
import { buildRouter } from './adapters/in/http/router.js';

// 조립(composition root)
const svc = new TenantService(new MysqlTenantRepository(), new MqttEventPublisher(config.mqttUrl), new SystemClock());

await migrate();

const app = express();
app.use(express.json());
app.use(buildRouter(svc, config.internalKey));
// express.json() 의 본문 파싱 오류(잘못된 JSON)도 {error} 형태로 응답
app.use((err: Error & { type?: string; status?: number }, _req: Request, res: Response, next: NextFunction) =>
  err.type?.startsWith('entity.')
    ? res.status(err.status ?? 400).json({ error: err.type === 'entity.too.large' ? '요청 본문이 너무 큽니다.' : '잘못된 JSON 요청입니다.' })
    : next(err),
);
app.listen(config.port, () => console.log(`[tenant-service] listening on :${config.port}`));
