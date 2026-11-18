import { Redis } from 'ioredis';
import { config } from '../../../config.js';

export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
redis.on('connect', () => console.log('[redis] connected'));
redis.on('error', (e: Error) => console.error('[redis] error', e.message));
