import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import os from 'os';
import { query } from './db.js';
import ocr from './handlers/ocr.js';
import extraction from './handlers/extraction.js';
import conversion from './handlers/conversion.js';
import report from './handlers/report.js';
import analytics from './handlers/analytics.js';

const PRIORITY = process.env.WORKER_PRIORITY;          // HIGH | MEDIUM | LOW
const QUEUE = PRIORITY.toLowerCase();
const HOST = os.hostname();

const handlers = { OCR: ocr, EXTRACTION: extraction, CONVERSION: conversion, REPORT: report, ANALYTICS: analytics };

const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

const logEvent = (jobId, event, meta = {}) =>
  query('insert into job_events (job_id, event, meta) values ($1, $2, $3)', [jobId, event, meta]);

const worker = new Worker(
  QUEUE,
  async (job) => {
    const { jobId } = job.data;
    const handler = handlers[job.name];
    if (!handler) throw new Error(`no handler for ${job.name}`);

    await query("update jobs set status='PROCESSING', started_at=now(), worker=$2 where id=$1", [jobId, HOST]);
    await logEvent(jobId, 'STARTED', { worker: HOST, pool: PRIORITY });
    try {
      const result = await handler(job.data);
      await query("update jobs set status='COMPLETED', finished_at=now(), result=$2 where id=$1", [jobId, result]);
      await logEvent(jobId, 'COMPLETED');
      return result;
    } catch (err) {
      await query("update jobs set status='FAILED', finished_at=now() where id=$1", [jobId]);
      await logEvent(jobId, 'FAILED', { error: err.message });
      throw err;
    }
  },
  { connection, concurrency: Number(process.env.CONCURRENCY || 1) }
);

worker.on('completed', (job) => console.log(`done  ${job.name} (job ${job.data.jobId})`));
worker.on('failed', (job, err) => console.log(`fail  ${job?.name}: ${err.message}`));

const beat = () => connection.set(`worker:${PRIORITY}:${HOST}`, '1', 'EX', 5);
beat();
setInterval(beat, 2000);

console.log(`${PRIORITY} worker ${HOST} listening on queue "${QUEUE}"`);