import { Queue, Worker } from 'bullmq';
import { connection } from './queues.js';
import { query } from './db.js';
import { createJob } from './jobs.js';

const schedQueue = new Queue('scheduler', { connection });
const PRESETS = { daily: '0 18 * * *', hourly: '0 * * * *' };
const TZ = 'Asia/Kolkata';

const register = (s) =>
  schedQueue.upsertJobScheduler(
    `sched-${s.id}`,
    { pattern: s.cron, tz: TZ },
    { name: 'FIRE', data: { operation: s.operation } }
  );

export async function addSchedule({ operation, preset }) {
  if (!['REPORT', 'ANALYTICS'].includes(operation)) throw new Error('only REPORT or ANALYTICS can be scheduled');
  const cron = PRESETS[preset];
  if (!cron) throw new Error('preset must be daily or hourly');
  const { rows: [s] } = await query(
    'insert into schedules (operation, cron) values ($1, $2) returning *', [operation, cron]);
  await register(s);
  return s;
}

export async function removeSchedule(id) {
  await schedQueue.removeJobScheduler(`sched-${id}`);
  await query('delete from schedules where id = $1', [id]);
}

// "Run now" for demos: same code path as a real trigger
export async function runNow(id) {
  const { rows: [s] } = await query('select * from schedules where id = $1', [id]);
  if (!s) throw new Error('unknown schedule');
  return createJob({ operation: s.operation, source: 'SCHEDULED' });
}

export async function startScheduler() {
  new Worker('scheduler',
    async (job) => { await createJob({ operation: job.data.operation, source: 'SCHEDULED' }); },
    { connection })
    .on('error', (err) => console.error(`[scheduler] worker error: ${err.message}`))
    .on('failed', (job, err) => console.error(`[scheduler] trigger failed: ${err.message}`));
  const { rows } = await query('select * from schedules where enabled');
  for (const s of rows) await register(s);   // re-register after a restart
}
