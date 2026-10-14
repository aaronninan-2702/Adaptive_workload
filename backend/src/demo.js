
import { query } from './db.js';
import { connection, queues } from './queues.js';
import { createDocument, createJob } from './jobs.js';

async function createDemoJob({ filename, operation, source }) {
  const document = await createDocument({
    filename,
    size: 1024
  });

  return createJob({
    documentId: document.id,
    operation,
    source
  });
}

export async function runBulkDemo() {
  const jobs = [];

  for (let i = 1; i <= 30; i++) {
    const job = await createDemoJob({
      filename: `routine-batch-${i}.txt`,
      operation: 'REPORT',
      source: 'SCHEDULED'
    });

    jobs.push(job);
  }

  return { created: jobs.length, jobs };
}

export async function runNormalDemo() {
  return createDemoJob({
    filename: 'company-policy.txt',
    operation: 'CONVERSION',
    source: 'USER'
  });
}

export async function runLegalDemo() {
  return createDemoJob({
    filename: 'legal-contract.txt',
    operation: 'OCR',
    source: 'USER'
  });
}

export async function runEmergencyDemo() {
  return createDemoJob({
    filename: 'security-incident.log',
    operation: 'EXTRACTION',
    source: 'EMERGENCY'
  });
}

export async function resetDemo() {
  for (const queue of Object.values(queues)) {
    await queue.pause();
    try {
      await queue.obliterate({ force: true });
    } finally {
      await queue.resume();
    }
  }

  await query('delete from job_events');
  await query('delete from jobs');
  await query('delete from documents');

  return { ok: true, message: 'Demo data and queues cleared' };
}