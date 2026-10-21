import { query } from './db.js';
import { queues } from './queues.js';
import { score, classify } from './engine.js';
import { logEvent } from './events.js';

export const OPERATIONS = ['OCR', 'EXTRACTION', 'CONVERSION', 'REPORT', 'ANALYTICS'];

export async function createDocument({ filename, size = 0 }) {
  const category = classify(filename);
  const { rows } = await query(
    'insert into documents (filename, size, category) values ($1, $2, $3) returning *',
    [filename, size, category]
  );
  return rows[0];
}

// source is set by the code path that calls this, never by the user
export async function createJob({ documentId = null, operation, source }) {
  if (!OPERATIONS.includes(operation)) throw new Error('unknown operation');

  let category = 'ROUTINE';
  let filename = null;
  if (documentId) {
    const { rows } = await query('select filename, category from documents where id = $1', [documentId]);
    if (!rows[0]) throw new Error('unknown document');
    ({ category, filename } = rows[0]);
  }

  const result = score({ source, category });
  const { rows: [job] } = await query(
    `insert into jobs (document_id, operation, source, priority, score, reason)
     values ($1, $2, $3, $4, $5, $6) returning *`,
    [documentId, operation, source, result.priority, result.score, result.reason]
  );

  await logEvent(job.id, 'CREATED', { source, category });
  await queues[result.priority].add(operation, { jobId: job.id, payload: { filename } });
  await logEvent(job.id, 'ROUTED', { queue: result.priority });
  return job;
}