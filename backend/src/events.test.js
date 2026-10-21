import test from 'node:test';
import assert from 'node:assert';
import { logEvent } from './events.js';

const captureLogger = () => {
  const lines = [];
  return { lines, error: (...args) => lines.push(args.join(' ')) };
};

test('inserts the event with job id, event name and meta', async () => {
  const calls = [];
  const result = await logEvent(7, 'CREATED', { source: 'USER' }, {
    exec: async (text, params) => {
      calls.push({ text, params });
      return { rows: [] };
    },
    logger: captureLogger(),
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /insert into job_events/);
  assert.deepEqual(calls[0].params, [7, 'CREATED', { source: 'USER' }]);
  assert.ok(result);
});

test('retries a transient failure and then records the event', async () => {
  let attempts = 0;
  const logger = captureLogger();

  await logEvent(3, 'STARTED', {}, {
    exec: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('getaddrinfo EAI_AGAIN');
      return { rows: [] };
    },
    wait: async () => {},
    logger,
  });

  assert.equal(attempts, 3);
  assert.equal(logger.lines.length, 2);
  assert.match(logger.lines[0], /attempt 1\/3/);
  assert.match(logger.lines[1], /attempt 2\/3/);
});

test('rethrows after the last attempt so a lost event is never silent', async () => {
  const logger = captureLogger();

  await assert.rejects(
    () => logEvent(9, 'FAILED', { error: 'boom' }, {
      attempts: 2,
      exec: async () => { throw new Error('connection terminated'); },
      wait: async () => {},
      logger,
    }),
    /job_events insert failed for job 9 event FAILED: connection terminated/
  );

  assert.equal(logger.lines.length, 2);
  assert.match(logger.lines[0], /job 9 event FAILED/);
  assert.match(logger.lines[1], /attempt 2\/2/);
});
