
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { query } from './db.js';
import { queues, connection } from './queues.js';
import { createDocument, createJob, OPERATIONS } from './jobs.js';
import { addSchedule, removeSchedule, runNow, startScheduler } from './scheduler.js';

const app = express();
app.use(cors());
app.use(express.json());

// Metadata only: keep the filename and size, not the file contents.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5e6 }
});

const route = (fn) => (req, res) =>
  fn(req, res).catch((e) => res.status(400).json({ error: e.message }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---------- documents ----------
app.post('/api/documents', upload.single('file'), route(async (req, res) => {
  if (!req.file) throw new Error('file required');

  res.json(await createDocument({
    filename: req.file.originalname,
    size: req.file.size
  }));
}));

app.get('/api/documents', route(async (req, res) => {
  res.json(
    (await query(
      'select id, filename, category from documents order by id desc limit 50'
    )).rows
  );
}));

// ---------- jobs ----------
app.post('/api/jobs', route(async (req, res) => {
  const { documentId, operation } = req.body;

  if (!OPERATIONS.includes(operation)) {
    throw new Error('unknown operation');
  }

  if (!documentId && !['REPORT', 'ANALYTICS'].includes(operation)) {
    throw new Error('documentId required');
  }

  res.json(await createJob({
    documentId: documentId ? Number(documentId) : null,
    operation,
    source: 'USER'
  }));
}));

app.get('/api/jobs', route(async (req, res) => {
  res.json(
    (await query(
      `select j.id, j.operation, j.source, j.priority, j.score, j.reason,
              j.status, j.worker, j.created_at, j.started_at, j.finished_at,
              d.filename
       from jobs j
       left join documents d on d.id = j.document_id
       order by j.id desc
       limit 40`
    )).rows
  );
}));

app.get('/api/jobs/:id/log', route(async (req, res) => {
  res.json(
    (await query(
      'select event, at, meta from job_events where job_id = $1 order by id',
      [req.params.id]
    )).rows
  );
}));

app.get('/api/jobs/:id/result', route(async (req, res) => {
  res.json(
    (await query(
      'select result from jobs where id = $1',
      [req.params.id]
    )).rows[0] ?? {}
  );
}));

// ---------- queues and workers ----------
app.get('/api/queues', route(async (req, res) => {
  const out = {};

  for (const [name, q] of Object.entries(queues)) {
    out[name] = await q.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed'
    );
  }

  res.json(out);
}));

// Workers send a heartbeat key that expires after 5 seconds.
app.get('/api/workers', route(async (req, res) => {
  const out = { HIGH: 0, MEDIUM: 0, LOW: 0 };

  for (const key of await connection.keys('worker:*')) {
    out[key.split(':')[1]]++;
  }

  res.json(out);
}));

// ---------- schedules ----------
app.get('/api/schedules', route(async (req, res) => {
  res.json(
    (await query('select * from schedules order by id desc')).rows
  );
}));

app.post('/api/schedules', route(async (req, res) => {
  res.json(
    await addSchedule({
      operation: req.body.operation,
      preset: req.body.preset
    })
  );
}));

app.delete('/api/schedules/:id', route(async (req, res) => {
  await removeSchedule(req.params.id);
  res.json({ ok: true });
}));

app.post('/api/schedules/:id/run', route(async (req, res) => {
  res.json(await runNow(req.params.id));
}));

// ---------- start ----------
const PORT = process.env.PORT || 3000;

startScheduler().then(() => {
  app.listen(PORT, () => console.log('backend on :' + PORT));
});
