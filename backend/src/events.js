import { query } from './db.js';

const INSERT_EVENT = 'insert into job_events (job_id, event, meta) values ($1, $2, $3)';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function logEvent(jobId, event, meta = {}, options = {}) {
  const {
    attempts = 3,
    backoffMs = 250,
    exec = query,
    wait = sleep,
    logger = console,
  } = options;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await exec(INSERT_EVENT, [jobId, event, meta]);
    } catch (err) {
      logger.error(
        `[job_events] insert failed (attempt ${attempt}/${attempts}) for job ${jobId} event ${event}: ${err.message}`
      );

      if (attempt === attempts) {
        const failure = new Error(
          `job_events insert failed for job ${jobId} event ${event}: ${err.message}`
        );
        failure.cause = err;
        throw failure;
      }

      await wait(backoffMs * attempt);
    }
  }
}
