import mqtt from 'mqtt';
import type { EventPublisher } from '../../../application/ports.js';

export class MqttEventPublisher implements EventPublisher {
  private readonly client;
  constructor(url: string) {
    this.client = mqtt.connect(url, { reconnectPeriod: 3000 });
    this.client.on('connect', () => console.log('[mqtt] connected'));
    this.client.on('error', (e) => console.error('[mqtt] error', e.message));
  }
  publish(topic: string, payload: unknown) {
    // 연결 전/끊김 중에는 mqtt.js 의 오프라인 큐가 보관했다가 재연결 시 전송한다. (영속 outbox 는 아님)
    this.client.publish(topic, JSON.stringify({ ...(payload as object), at: new Date().toISOString() }), { qos: 1 });
  }
}
