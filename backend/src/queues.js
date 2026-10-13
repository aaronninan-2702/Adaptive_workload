import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null, // BullMQ requires this setting
});

export const queues = {
  HIGH: new Queue('high', { connection }),
  MEDIUM: new Queue('medium', { connection }),
  LOW: new Queue('low', { connection }),
};