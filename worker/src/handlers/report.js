import { query } from '../db.js';
import { burn } from './burn.js';
import { DAY_START } from './dayStart.js';

export default async function report() {
  await burn(6000);

  const { rows: events } = await query(
    `select e.at, e.event, j.id, j.operation, j.priority
     from job_events e join jobs j on j.id = e.job_id
     where e.at >= ${DAY_START} and e.event in ('CREATED','STARTED','COMPLETED','FAILED')
     order by e.at`
  );
  const { rows: summary } = await query(
    `select operation, priority, status, count(*)::int as n
     from jobs where created_at >= ${DAY_START}
     group by 1, 2, 3 order by 1, 2`
  );

  const time = (d) => new Date(d).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata' });
  return {
    kind: 'DAILY_REPORT',
    totalJobs: summary.reduce((a, r) => a + r.n, 0),
    summary,
    log: events.map((e) => `${time(e.at)}  J-${e.id}  ${e.operation}  ${e.priority}  ${e.event}`).join('\n'),
  };
}