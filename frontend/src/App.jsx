import { useCallback, useEffect, useState } from 'react';
import './App.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }

  return data;
}

function App() {
  const [jobs, setJobs] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [queues, setQueues] = useState({});
  const [workers, setWorkers] = useState({});
  const [schedules, setSchedules] = useState([]);
  const [operation, setOperation] = useState('OCR');
  const [documentId, setDocumentId] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const refresh = useCallback(async () => {
    const endpoints = [
      ['/api/jobs', setJobs],
      ['/api/documents', setDocuments],
      ['/api/queues', setQueues],
      ['/api/workers', setWorkers],
      ['/api/schedules', setSchedules],
    ];

    const results = await Promise.allSettled(
      endpoints.map(async ([path, setter]) => {
        const data = await request(path);
        setter(data);
      })
    );

    const failed = results.find((result) => result.status === 'rejected');

    if (failed) {
      setError(`Could not refresh all dashboard data: ${failed.reason.message}`);
    } else {
      setError('');
      setLastUpdated(new Date());
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  const counts = {
    total: jobs.length,
    completed: jobs.filter((job) => job.status === 'COMPLETED').length,
    queued: jobs.filter(
      (job) => ['QUEUED', 'PENDING', 'WAITING'].includes(job.status)
    ).length,
    failed: jobs.filter((job) => job.status === 'FAILED').length,
  };

  async function uploadDocument(event) {
    event.preventDefault();

    if (!file) {
      setError('Choose a document first.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');

    try {
      const form = new FormData();
      form.append('file', file);

      const doc = await request('/api/documents', {
        method: 'POST',
        body: form,
      });

      setFile(null);
      event.target.reset();
      setDocumentId(String(doc.id));
      setMessage(`Uploaded ${doc.filename}. Category: ${doc.category}.`);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitJob(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const body = { operation };

      if (documentId) {
        body.documentId = Number(documentId);
      }

      const job = await request('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      setMessage(
        `Job #${job.id} created · ${job.priority} priority · ${job.reason}`
      );
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runDemo(type) {
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const result = await request(`/api/demo/${type}`, {
        method: 'POST',
      });

      const summary = result.created
        ? `${result.created} jobs created successfully.`
        : `Job #${result.id} created · ${result.priority} priority.`;

      setMessage(summary);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runSchedule(id) {
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const result = await request(`/api/schedules/${id}/run`, {
        method: 'POST',
      });

      setMessage(`Schedule triggered: ${JSON.stringify(result)}`);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">AW</div>
          <div>
            <strong>Adaptive</strong>
            <span>Workload Management</span>
          </div>
        </div>

        <div className="nav-label">WORKSPACE</div>
        <a className="nav-item active" href="#overview">◫ &nbsp; Overview</a>
        <a className="nav-item" href="#queues">▤ &nbsp; Priority queues</a>
        <a className="nav-item" href="#jobs">▦ &nbsp; Job history</a>
        <a className="nav-item" href="#submit">＋ &nbsp; Submit workload</a>
        <a className="nav-item" href="#schedules">◷ &nbsp; Schedules</a>

        <div className="sidebar-bottom">
          <div className="live-dot" />
          <div>
            <strong>Local environment</strong>
            <span>API · {API}</span>
          </div>
        </div>
      </aside>

      <section className="main-content">
        <header className="topbar">
          <div>
            <div className="eyebrow">WORKLOAD CONTROL CENTER</div>
            <h1>Overview</h1>
          </div>
          <button className="button secondary" onClick={refresh}>
            ↻ Refresh
          </button>
        </header>

        <section className="welcome-panel" id="overview">
          <div className="welcome-copy">
            <div className="eyebrow light">INTELLIGENT JOB SCHEDULING</div>
            <h2>Right job. Right priority. Right time.</h2>
            <p>
              Workloads are automatically classified and routed to isolated
              worker pools based on urgency and business impact.
            </p>
            <a href="#submit" className="button light-button">
              Submit a workload →
            </a>
          </div>

          <div className="priority-orbit" aria-label="Priority pools">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit-center">AUTO<br />ROUTE</div>
            <div className="orbit-label high-label">HIGH</div>
            <div className="orbit-label medium-label">MEDIUM</div>
            <div className="orbit-label low-label">LOW</div>
          </div>
        </section>

        {error && <div className="notice error-notice">{error}</div>}
        {message && <div className="notice success-notice">{message}</div>}

        <section className="stats-grid">
          <StatCard label="Total jobs shown" value={counts.total} note="Latest 40 jobs" />
          <StatCard label="Completed" value={counts.completed} note="Successfully processed" />
          <StatCard label="Queued" value={counts.queued} note="Waiting for processing" />
          <StatCard label="Failed" value={counts.failed} note="Requires investigation" />
        </section>

        <section id="queues" className="section-block">
          <div className="section-heading">
            <div>
              <div className="eyebrow">RESOURCE DISTRIBUTION</div>
              <h2>Priority queues</h2>
            </div>
            <span className="subtle">Live queue counts</span>
          </div>

          <div className="queue-grid">
            {[
              { name: 'HIGH', color: 'red', description: 'Urgent · Legal · Security' },
              { name: 'MEDIUM', color: 'amber', description: 'Standard user workloads' },
              { name: 'LOW', color: 'blue', description: 'Routine · Scheduled jobs' },
            ].map((pool) => {
              const stats = queues[pool.name.toLowerCase()] || {};
              const workerCount = workers[pool.name] ?? 0;

              return (
                <article className="queue-card" key={pool.name}>
                  <div className="queue-card-top">
                    <span className={`priority-icon ${pool.color}`}>
                      {pool.name === 'HIGH' ? '↑' : pool.name === 'MEDIUM' ? '↔' : '↓'}
                    </span>
                    <span className={`priority-pill ${pool.color}`}>{pool.name}</span>
                  </div>
                  <h3>{pool.description}</h3>
                  <div className="queue-numbers">
                    <div>
                      <strong>{stats.waiting ?? 0}</strong>
                      <span>Waiting</span>
                    </div>
                    <div>
                      <strong>{stats.active ?? 0}</strong>
                      <span>Active</span>
                    </div>
                  </div>
                  <div className="queue-footer">
                    <span className="live-dot" />
                    {workerCount} registered worker{workerCount === 1 ? '' : 's'}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section id="submit" className="section-block">
          <div className="section-heading">
            <div>
              <div className="eyebrow">CONTROLLED TESTING</div>
              <h2>Run a demo scenario</h2>
            </div>
          </div>

          <div className="demo-grid">
            <DemoCard
              icon="◷"
              title="Routine batch"
              description="Create 30 scheduled report jobs routed to LOW."
              label="Create 30 jobs"
              disabled={busy}
              onClick={() => runDemo('bulk')}
            />
            <DemoCard
              icon="▤"
              title="Normal document"
              description="Simulate a policy conversion routed to MEDIUM."
              label="Run normal"
              disabled={busy}
              onClick={() => runDemo('normal')}
            />
            <DemoCard
              icon="⚖"
              title="Legal contract"
              description="Simulate legal OCR routed to HIGH."
              label="Run legal"
              disabled={busy}
              onClick={() => runDemo('legal')}
            />
            <DemoCard
              icon="⚡"
              title="Security incident"
              description="Simulate emergency extraction at HIGH priority."
              label="Trigger emergency"
              disabled={busy}
              onClick={() => runDemo('emergency')}
            />
          </div>
        </section>

        <section className="section-block forms-grid">
          <article className="panel">
            <div className="eyebrow">DOCUMENT INGESTION</div>
            <h2>Upload a document</h2>
            <p className="panel-description">
              The backend classifies the file from its filename.
            </p>
            <form onSubmit={uploadDocument} className="form-stack">
              <input
                type="file"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
                required
              />
              <button className="button primary" disabled={busy}>
                {busy ? 'Please wait…' : 'Upload document'}
              </button>
            </form>
          </article>

          <article className="panel">
            <div className="eyebrow">JOB SUBMISSION</div>
            <h2>Create a job</h2>
            <p className="panel-description">
              Choose the operation. The system decides priority automatically.
            </p>
            <form onSubmit={submitJob} className="form-stack">
              <label htmlFor="operation">Operation</label>
              <select
                id="operation"
                value={operation}
                onChange={(event) => setOperation(event.target.value)}
              >
                {['OCR', 'EXTRACTION', 'CONVERSION', 'REPORT', 'ANALYTICS'].map((op) => (
                  <option key={op} value={op}>{op}</option>
                ))}
              </select>

              <label htmlFor="document">Document</label>
              <select
                id="document"
                value={documentId}
                onChange={(event) => setDocumentId(event.target.value)}
              >
                <option value="">No document (REPORT / ANALYTICS)</option>
                {documents.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    #{doc.id} · {doc.filename} ({doc.category})
                  </option>
                ))}
              </select>

              <button className="button primary" disabled={busy}>
                Create job
              </button>
            </form>
          </article>
        </section>

        <section id="jobs" className="section-block">
          <div className="section-heading">
            <div>
              <div className="eyebrow">PROCESSING ACTIVITY</div>
              <h2>Recent jobs</h2>
            </div>
            <span className="subtle">
              {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Loading…'}
            </span>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Workload</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Worker</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="empty-cell">
                      No jobs found. Run a demo to get started.
                    </td>
                  </tr>
                ) : jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="job-id">#{job.id}</td>
                    <td>
                      <strong>{job.operation}</strong>
                      <span className="table-secondary">{job.filename || 'No document'}</span>
                    </td>
                    <td><span className={`priority-pill ${String(job.priority || '').toLowerCase()}`}>{job.priority}</span></td>
                    <td><span className={`status-pill ${String(job.status || '').toLowerCase()}`}>{job.status}</span></td>
                    <td>{job.worker || '—'}</td>
                    <td>{job.created_at ? new Date(job.created_at).toLocaleTimeString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="schedules" className="section-block">
          <div className="section-heading">
            <div>
              <div className="eyebrow">AUTOMATION</div>
              <h2>Schedules</h2>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>ID</th><th>Operation</th><th>Preset</th><th>Action</th></tr>
              </thead>
              <tbody>
                {schedules.length === 0 ? (
                  <tr><td colSpan="4" className="empty-cell">No schedules configured yet.</td></tr>
                ) : schedules.map((schedule) => (
                  <tr key={schedule.id}>
                    <td>#{schedule.id}</td>
                    <td>{schedule.operation}</td>
                    <td>{schedule.preset}</td>
                    <td>
                      <button
                        className="button small secondary"
                        disabled={busy}
                        onClick={() => runSchedule(schedule.id)}
                      >
                        Run now
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="footer">
          <span>ADAPTIVE WORKLOAD MANAGEMENT</span>
          <span>React · Express · BullMQ · Redis · PostgreSQL</span>
        </footer>
      </section>
    </main>
  );
}

function StatCard({ label, value, note }) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function DemoCard({ icon, title, description, label, disabled, onClick }) {
  return (
    <article className="demo-card">
      <div className="demo-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      <button className="button secondary" onClick={onClick} disabled={disabled}>
        {label} →
      </button>
    </article>
  );
}

export default App;