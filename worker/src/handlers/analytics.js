import { query } from '../db.js';
import { burn } from './burn.js';
import { DAY_START } from './dayStart.js';

export default async function analytics() {
  await burn(5000);

  const { rows } = await query(
    `select priority,
            count(*)::int as jobs,
            count(*) filter (where status = 'FAILED')::int as failed,
            round(avg(extract(epoch from started_at - created_at))::numeric, 1) as avg_wait_sec,
            round(avg(extract(epoch from finished_at - started_at))::numeric, 1) as avg_proc_sec
     from jobs
     where finished_at is not null and created_at >= ${DAY_START}
     group by priority order by priority`
  );
  return { kind: 'ANALYTICS', byPriority: rows };
}