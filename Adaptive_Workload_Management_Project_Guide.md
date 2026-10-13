# Adaptive Workload Management in Containerized Environments
### Complete project guide: concept, architecture, implementation status and remaining work

---

## 1. Project in one paragraph

A document-processing platform that demonstrates **adaptive workload management**. Users submit processing requests (OCR, extraction, conversion, reports, analytics). The user **never chooses a priority**. A backend priority engine derives HIGH / MEDIUM / LOW from objective context (event source, document category, deadline pressure). Each job is routed to a dedicated BullMQ queue (Redis) and processed by a worker pool that runs on its own Kubernetes node, with its own resources, scaling and recovery behaviour.

> The application decides how important a workload is. Kubernetes decides how to provide reliable, isolated and scalable infrastructure for processing it.

**One-line workflow:**
`Request -> Job created -> Context analysed -> Priority calculated -> Redis queue -> Dedicated worker pool -> Result -> Postgres -> Dashboard`

---

## 2. Problem statement

In an enterprise, many processing jobs arrive together but do not share the same urgency. With one queue and one worker pool, routine background work (archives, nightly reports) can occupy capacity while time-sensitive jobs (legal deadlines, security incidents) wait. A worker failure can also lose work.

The project solves this by:
1. Deriving priority automatically and tamper-proof.
2. Separating jobs into isolated priority queues.
3. Running independently managed worker pools that scale and recover on their own.

---

## 3. Core design principle: operation and priority are independent

Two independent properties on every job:

| Axis | Question | Decided by | Controls |
|---|---|---|---|
| **Operation** | *What* work is this? | User picks it | Which handler runs and how heavy it is |
| **Context** | *How urgent* is it? | Backend derives it | Priority score, queue, worker pool |

The same operation can land in different pools:

| Operation | Context | Priority |
|---|---|---|
| OCR | Scheduled routine batch | LOW |
| OCR | Normal policy document, user request | MEDIUM |
| OCR | Legal contract with a 2h deadline | HIGH |
| Extraction | Emergency security incident | HIGH |
| Report | Scheduled daily report | LOW |

Because OCR is heavy and Conversion is light, a LOW job can be expensive and a HIGH job cheap. The demo shows that **priority and resource cost are separate concepts**.

---

## 4. Technology stack

| Layer | Choice | Role |
|---|---|---|
| Frontend | React (Vite) | Dashboard, submit form, demo buttons |
| Backend | Node.js + Express | API, priority engine, job creation, scheduler |
| Queue | BullMQ on Redis | Three priority queues, retries, stalled-job recovery |
| Database | PostgreSQL on Supabase | Permanent job, document, event and schedule records |
| Containers | Docker | One image each for backend, worker, frontend |
| Orchestration | Kubernetes (kind, 5 nodes) | Node-level isolation, scaling, self-healing |
| CI/CD | Jenkins | Build, test, image build, deploy |
| Monitoring | Not included | Dashboard and kubectl cover the demo |

**Supabase is used only as hosted Postgres** (via the `pg` library, session-pooler connection string). No Supabase auth, storage or client library. Redis stays inside the cluster because Supabase does not provide it. For the report: *no cloud for compute; managed Postgres used for persistence.* Keep a local Postgres fallback in case of no internet on demo day.

---

## 5. What Redis, BullMQ and Postgres each do

| Component | Role |
|---|---|
| **Redis** | In-memory storage for the three queues, job state, locks and worker heartbeat keys. Shared by backend and all worker pods |
| **BullMQ** | Node library on top of Redis. `Queue` (producer, used by backend) and `Worker` (consumer, used by workers). Gives retries, concurrency, stalled-job recovery and job counts |
| **PostgreSQL** | Permanent record: documents, jobs, audit events, schedules. Redis holds transient "what is waiting now"; Postgres holds history |

Why BullMQ and not a plain Redis list: if a worker pod is killed mid-job, BullMQ notices the expired lock and re-delivers the job. That makes the self-healing demo meaningful ("pending work continues").

---

## 6. Architecture

```
                 React Frontend
                       |
              Express API (backend)
        +--------------+---------------+
        |                              |
   PostgreSQL (Supabase)        Priority Engine
                                       |
                              BullMQ producers
                                       |
                                     Redis
          +----------------+-----------+-----------+
          v                v                       v
     queue "high"    queue "medium"           queue "low"
          |                |                       |
     HIGH workers    MEDIUM workers           LOW workers
     (high node)     (medium node)            (low node)
          |                |                       |
          +----------- results / events -----------+
                           v
                      PostgreSQL
```

### Kubernetes layout (one kind cluster, 5 nodes)

| Node | Label | Taint | Runs |
|---|---|---|---|
| control-plane | default | default | Kubernetes system components only |
| app node | `role=app` | none | Frontend, backend (API + scheduler), Redis |
| high node | `priority=high` | `priority=high:NoSchedule` | HIGH worker pods |
| medium node | `priority=medium` | `priority=medium:NoSchedule` | MEDIUM worker pods |
| low node | `priority=low` | `priority=low:NoSchedule` | LOW worker pods |

- Taint keeps other pods **off** the node; `nodeSelector` keeps the worker **on** it. Both are needed.
- One worker image, three Deployments, different environment variables (`WORKER_PRIORITY`, `CONCURRENCY`), resource limits and replica counts.
- Postgres is on Supabase, so it is not on the app node.

| Property | HIGH | MEDIUM | LOW |
|---|---|---|---|
| Queue | `high` | `medium` | `low` |
| Replicas (min-max) | 1-3 | 1-2 | 1-2 |
| Concurrency | 3 | 2 | 1 |
| Resources (example) | 500m CPU / 256Mi | 300m / 256Mi | 200m / 256Mi |

**Honest caveat for the report:** kind nodes are Docker containers sharing one laptop CPU, so this shows *scheduling* isolation, not hardware isolation. The app node is a single point of failure (acceptable for a prototype).

---

## 7. Priority engine (backend only)

A pure, deterministic function. Nothing in it comes from the user.

### Inputs (all backend-derived)

| Factor | How it is obtained | Values (0-5) |
|---|---|---|
| **Event source (E)** | Set by the code path that creates the job | SCHEDULED 0, USER 2, DEADLINE 3, EMERGENCY 5 |
| **Business impact (I)** | Classified from the filename | ROUTINE 1, NORMAL 2, FINANCIAL 3, LEGAL 5, SECURITY 5 |
| **Deadline pressure (D)** | Default deadline window (SLA) per category | see below |

**Filename classification:** `incident|security|breach` -> SECURITY; `contract|agreement|legal` -> LEGAL; `invoice|bill|payment` -> FINANCIAL; `policy|memo` -> NORMAL; otherwise ROUTINE.

**Default deadline windows:** LEGAL 2h, FINANCIAL 1h, SECURITY 15min, NORMAL 24h, ROUTINE none.

**Deadline pressure mapping:**

| Time left | D |
|---|---|
| none or > 72h | 0 |
| <= 72h | 1 |
| <= 24h | 2 |
| <= 6h | 3 |
| <= 2h | 4 |
| <= 30 min | 5 |

### Formula

```
score = 35*(E/5) + 30*(I/5) + 35*(D/5)        range 0-100
score < 30   -> LOW
30 - 64      -> MEDIUM
>= 65        -> HIGH
```

### Worked examples

| Source | Category | Score | Priority |
|---|---|---|---|
| SCHEDULED | ROUTINE | 6 | LOW |
| USER | NORMAL | 40 | MEDIUM |
| USER | LEGAL | 72 | HIGH |
| EMERGENCY | SECURITY | 100 | HIGH |

Each job stores a readable reason, e.g. `HIGH: user event, legal document, deadline 2h (score 72)`.

---

## 8. User control vs system control

| User controls | System controls |
|---|---|
| Upload a document (filename, size) | Category and deadline |
| Choose an operation | Event source |
| Optionally schedule a report | Score, priority, reason |
| View status, results, logs | Job ID, queue, worker assignment |

Rules enforced in the API:
- `POST /api/jobs` reads **only** `documentId` and `operation`. Any `priority`, `score`, `source` or `deadline` in the body is ignored.
- `source` is always passed by the calling code (`USER` for the API, `SCHEDULED` for the scheduler, etc.), never read from a request.
- Scheduling is restricted to REPORT and ANALYTICS and always runs as `SCHEDULED` (so it scores LOW).

---

## 9. The five services (worker handlers)

One worker codebase, one handler module per operation. A handler receives job data, does its work and returns a result. It never touches status, events or priority; the worker wrapper does that.

| # | Operation | Type | Simulated cost | Result |
|---|---|---|---|---|
| 1 | OCR | Simulated | ~8s CPU (heavy) | `{ pages, text }` |
| 2 | Extraction | Simulated | ~4s CPU | `{ invoiceNo, amount }` |
| 3 | Conversion | Simulated | ~3s CPU (light) | `{ output }` |
| 4 | Report | **Real** | ~6s + DB queries | Day summary + text log from `job_events` |
| 5 | Analytics | **Real** | ~5s + DB queries | Avg wait / processing time and failures per priority |

- `burn(ms)` creates real CPU load in 50 ms slices (so BullMQ can renew its lock). `DURATION_SCALE` speeds up or slows down every job.
- Report and Analytics use "today" in IST (`Asia/Kolkata`) because Supabase runs in UTC.
- Average wait per priority (HIGH seconds vs LOW much longer during a flood) is the number that proves the design.

### Worker wrapper lifecycle

1. Mark job `PROCESSING`, log `STARTED` (with worker name and pool).
2. Run the handler.
3. Save result, mark `COMPLETED`, log `COMPLETED` (or `FAILED` with the error).
4. Heartbeat: `SET worker:<PRIORITY>:<hostname> 1 EX 5` every 2s. The dashboard counts these keys; a killed worker's key disappears within ~5s, making the pod-kill demo visible.

---

## 10. Database schema (Supabase / Postgres)

```sql
create table documents (
  id serial primary key,
  filename text not null,
  size int default 0,
  category text not null,
  uploaded_at timestamptz default now()
);

create table jobs (
  id serial primary key,
  document_id int references documents(id),
  operation text not null,
  source text not null,
  status text not null default 'QUEUED',
  priority text not null,
  score int not null,
  reason text,
  result jsonb,
  worker text,
  created_at timestamptz default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table job_events (
  id serial primary key,
  job_id int references jobs(id),
  event text not null,
  at timestamptz default now(),
  meta jsonb default '{}'
);

create table schedules (
  id serial primary key,
  operation text not null,
  cron text not null,
  enabled boolean default true
);
```

| Table | Purpose |
|---|---|
| `documents` | Metadata only (file contents are not stored; processing is simulated) |
| `jobs` | Core record: operation, source, priority, score, reason, status, timestamps, result |
| `job_events` | Audit log: `CREATED`, `ROUTED`, `STARTED`, `COMPLETED`, `FAILED`. Daily report is built from it |
| `schedules` | Remembers schedules so they are re-registered after a backend restart |

Connection notes: use the Supabase **session pooler** URI (port 5432); pass `ssl: { rejectUnauthorized: false }`; URL-encode special characters in the password; keep pool sizes small (backend 5, worker 3); store `DATABASE_URL` in a Kubernetes Secret and never commit it. Free projects pause after about a week idle, so open the dashboard the day before the demo.

---

## 11. Job lifecycle

```
POST /api/jobs { documentId, operation }
  -> load document -> category
  -> engine.score({ source: 'USER', category })       -> score, priority, reason
  -> INSERT jobs row (status QUEUED)
  -> INSERT job_events CREATED
  -> queues[priority].add(operation, { jobId, payload })   (Redis)
  -> INSERT job_events ROUTED
Worker on that queue:
  -> PROCESSING + STARTED -> handler -> COMPLETED (result saved) or FAILED
```

`createJob({ documentId, operation, source })` is the single entry point used by the API, the scheduler and the demo endpoints. Postgres is written before Redis, so every queued job has a record. Priority is never sent to the worker.

---

## 12. Scheduler

- BullMQ job scheduler stores cron patterns in Redis; a small trigger worker inside the backend receives each trigger and calls `createJob({ operation, source: 'SCHEDULED' })`, so scheduled jobs go through the same engine and land in LOW.
- Presets: `daily` = `0 18 * * *`, `hourly` = `0 * * * *`, timezone `Asia/Kolkata`.
- On backend start, all enabled rows in `schedules` are re-registered (idempotent via stable id `sched-<id>`).
- "Run now" endpoint fires a schedule immediately for demos.

---

## 13. Backend API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness check |
| POST | `/api/documents` | Upload (metadata only), classify category |
| GET | `/api/documents` | List documents |
| POST | `/api/jobs` | Create a job (`documentId`, `operation` only; source = USER) |
| GET | `/api/jobs` | Latest 40 jobs with priority, reason, status, worker |
| GET | `/api/jobs/:id/log` | Audit events for a job |
| GET | `/api/jobs/:id/result` | Job result (e.g. the daily report) |
| GET | `/api/queues` | Waiting / active / completed / failed per queue |
| GET | `/api/workers` | Live worker count per pool (heartbeat keys) |
| GET/POST | `/api/schedules` | List / create schedules (REPORT or ANALYTICS only) |
| DELETE | `/api/schedules/:id` | Remove a schedule |
| POST | `/api/schedules/:id/run` | Run a schedule now |
| POST | `/api/demo/bulk` | 30 background jobs (scheduled, routine document) -> LOW |
| POST | `/api/demo/normal` | Conversion of a policy document (user) -> MEDIUM |
| POST | `/api/demo/legal` | OCR of a contract (user) -> HIGH |
| POST | `/api/demo/emergency` | Extraction of an incident log (emergency) -> HIGH |
| POST | `/api/demo/reset` | Clear jobs, events and queues |

Demo endpoints do not bypass the engine: each calls `createJob` with a document and a source, and the engine still decides the priority. They are for presentation only.

---

## 14. Frontend plan (React + Vite)

Keep it plain; marks come from orchestration, not styling. One page, four sections:

1. **Pool cards:** per HIGH / MEDIUM / LOW: waiting, processing, done, failed, workers online (poll `/api/queues` and `/api/workers` every ~1.5s).
2. **Submit form:** file upload, operation dropdown, submit. No priority field.
3. **Presentation controls:** Flood LOW, Normal, Urgent legal, Emergency, Reset; schedule daily report and "Run now".
4. **Jobs table:** id, operation, document, priority badge, reason, status, worker; links to log and result (report viewer shows the text log).

Vite proxy (`/api` -> `http://localhost:3000`) avoids CORS issues in development.

---

## 15. Project structure

```
adaptive-workload/
  backend/
    src/  index.js  engine.js  engine.test.js  db.js  queues.js
          jobs.js  scheduler.js  demo.js
    .env  .env.example  package.json
  worker/
    src/  index.js  db.js
          handlers/  burn.js ocr.js extraction.js conversion.js
                     dayStart.js report.js analytics.js
    .env  .env.example  package.json
  frontend/            (Vite React app)
  k8s/                 (manifests, Day 3)
  docker-compose.yml   (Redis for local development)
  README.md  .gitignore
```

`.gitignore`: `node_modules`, `.env`, `dist`. Project lives in `C:\dev\adaptive-workload` (outside OneDrive to avoid sync and file-lock problems).

---

## 16. Local development quick reference (Windows / PowerShell)

```powershell
# Redis (Docker Desktop must be running)
cd C:\dev\adaptive-workload
docker compose up -d
docker compose exec redis redis-cli ping            # PONG

# Backend
cd backend ; npm run dev                            # backend on :3000

# Workers: one terminal per pool
cd worker ; npm run dev                             # uses WORKER_PRIORITY from .env (HIGH)
cd worker ; $env:WORKER_PRIORITY="MEDIUM"; npm run dev
cd worker ; $env:WORKER_PRIORITY="LOW"; npm run dev

# Frontend
cd frontend ; npm run dev

# Tests
cd backend ; npm test
```

Environment files:
- `backend/.env`: `PORT`, `REDIS_URL`, `DATABASE_URL`
- `worker/.env`: `WORKER_PRIORITY`, `CONCURRENCY`, `DURATION_SCALE`, `REDIS_URL`, `DATABASE_URL`

Useful checks: `docker compose exec redis redis-cli keys "worker:*"` (live workers), `docker compose exec redis redis-cli llen bull:high:wait` (waiting HIGH jobs).

---

## 17. Implementation status

### Completed
- [x] Folder structure, dependencies (backend, worker), project moved out of OneDrive
- [x] Supabase project and the 4 tables; DB connection tested
- [x] Priority engine with passing unit tests
- [x] Redis in Docker; three BullMQ queues
- [x] `createJob()` tying engine, Postgres and queues together
- [x] Worker wrapper (status updates, events, heartbeat) with OCR, Extraction, Conversion handlers
- [x] Express API (documents, jobs, queues, workers)
- [x] Report and Analytics handlers (real, Postgres-backed) registered in the worker
- [x] Scheduler (BullMQ job scheduler, schedule routes, Run now); full `index.js` provided

### Code provided, confirm it runs
- [ ] Demo endpoints (`backend/src/demo.js` and the five `/api/demo/*` routes): verify flood -> LOW backlog, emergency/legal -> HIGH finishing first, reset works

### Remaining

| # | Task | Done when | Est. |
|---|---|---|---|
| 1 | **React frontend** (pool cards, submit form, demo buttons, schedules, jobs table, report viewer) | Whole story runs from the browser locally | 2-3 hrs |
| 2 | **Local end-to-end test** with 3 workers (HIGH, MEDIUM, LOW) | LOW flood builds while HIGH finishes first | 30 min |
| 3 | **Dockerfiles** for backend, worker, frontend | Each image builds and runs | 1 hr |
| 4 | **Kubernetes on kind** (5 nodes, taints, manifests, Secret for `DATABASE_URL`, `kind load`) | `kubectl get pods -o wide` shows each pool on its own node | 3-4 hrs |
| 5 | **Scaling and pod-kill demo** | Deleted HIGH pod is recreated on the HIGH node, jobs continue | 1 hr |
| 6 | **Jenkinsfile** (install, test, build images, deploy, smoke test) | Build and test stages run; deploy if time allows | 1.5 hrs |
| 7 | **README, demo script, backup demo video** | Presentable without touching code | 1.5 hrs |

Rules: do not start Docker/Kubernetes work until the local end-to-end flow works. Keep the frontend plain. If Jenkins takes more than 90 minutes, show the Jenkinsfile and a successful first-stages build.

---

## 18. Kubernetes implementation notes (for step 4-5)

Cluster config (`kind-config.yaml`):

```yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
  - role: worker
    labels: { role: app }
    extraPortMappings:
      - { containerPort: 30080, hostPort: 8080 }   # frontend
      - { containerPort: 30000, hostPort: 3000 }   # backend
  - role: worker
    labels: { priority: high }
  - role: worker
    labels: { priority: medium }
  - role: worker
    labels: { priority: low }
```

Taint after creation:
```
kubectl taint nodes <high-node>   priority=high:NoSchedule
kubectl taint nodes <medium-node> priority=medium:NoSchedule
kubectl taint nodes <low-node>    priority=low:NoSchedule
```

Worker Deployment pinning (HIGH shown):
```yaml
spec:
  template:
    spec:
      nodeSelector: { priority: high }
      tolerations:
        - { key: priority, operator: Equal, value: high, effect: NoSchedule }
      containers:
        - name: worker
          env:
            - { name: WORKER_PRIORITY, value: HIGH }
            - { name: CONCURRENCY, value: "3" }
            - name: DATABASE_URL
              valueFrom: { secretKeyRef: { name: db-secret, key: DATABASE_URL } }
          resources:
            requests: { cpu: 200m, memory: 128Mi }
            limits:   { cpu: 500m, memory: 256Mi }
```
Backend, frontend and Redis use `nodeSelector: { role: app }`.

Pitfalls:
- kind cannot see local Docker images: run `kind load docker-image <image>` after every build.
- A pool can only scale as far as its node's capacity; unscheduled pods show `Pending` (itself a demo moment).
- Delete pods with `kubectl delete pod`, not `docker stop` on the node.
- Resource limits keep the five-node cluster usable on a laptop (roughly 2-2.5 GB idle for the nodes; 8 GB RAM minimum, 16 GB comfortable).
- Workers need internet access to reach Supabase.
- Scaling: `kubectl scale deploy worker-high --replicas=3` is more reliable than CPU-based HPA locally; HPA is an optional bonus.

Verification commands: `kubectl get nodes --show-labels`, `kubectl get pods -o wide`, `kubectl top nodes` (needs metrics-server, optional).

---

## 19. CI/CD plan (Jenkins, kept minimal)

```
Push to GitHub -> Jenkins -> npm install -> npm test (engine tests)
  -> docker build backend / worker / frontend -> kind load
  -> kubectl apply -f k8s/ -> smoke test (/api/health)
```
No GitOps or multi-environment release. Do it last and timebox it.

---

## 20. Presentation / demo script (about 5 minutes)

1. **Placement:** `kubectl get pods -o wide` shows each pool on its own node.
2. **Dashboard:** three pools, workers online per pool.
3. **Flood LOW:** 30 background jobs; LOW backlog builds on the dashboard.
4. **Urgent legal OCR:** scores HIGH with the reason shown and finishes while LOW is still backed up (user never chose HIGH).
5. **Emergency incident:** also HIGH; same operation type can be LOW or HIGH depending on context.
6. **Isolation and scaling:** scale the HIGH pool (`kubectl scale ...`); show the HIGH node is separate from the busy LOW node.
7. **Self-healing:** delete a HIGH pod; workers-online drops, Kubernetes recreates it on the HIGH node, jobs continue.
8. **Schedule and report:** schedule the daily report (18:00), click "Run now", open the report log.
9. **Analytics:** run Analytics to show average wait per priority (HIGH seconds vs LOW much longer).
10. **CI/CD:** show the Jenkins build or the Jenkinsfile.

Backup: record a demo video once it works. Reset between runs with `/api/demo/reset`. `DURATION_SCALE` adjusts job durations to fit the time slot.

---

## 21. Scope control

### In scope (MVP)
Context-derived priority; three BullMQ queues; three isolated worker pools on separate nodes; five services (three simulated, two real); scheduler with daily report; audit log and reports; self-healing and manual scaling demo; minimal Jenkins pipeline.

### Out of scope / future work
Real OCR or file processing; Prometheus/Grafana; HPA (optional bonus); dead-letter queues; priority aging (jobs cannot change queue while waiting without a re-router); node-affinity beyond taints/selectors; authentication/RBAC; cloud deployment of compute; multi-node Redis or Postgres.

### Design decisions worth stating in the report
- No separate "Redis priority structure" layer: the router is backend code that pushes to the correct queue.
- Three worker Deployments, five operations handled inside one image (not five worker services).
- BullMQ instead of plain Redis lists, for stalled-job recovery.
- Deadlines derive from category windows, never from user input.
- Honest limitations: shared laptop CPU (scheduling isolation, not hardware isolation), app node single point of failure, Supabase requires internet.

---

## 22. Common problems and fixes

| Symptom | Cause / fix |
|---|---|
| `failed to connect to the docker API ... dockerDesktopLinuxEngine` | Docker Desktop not running; start it and wait for "Engine running" |
| `--env-file` not recognised | Node older than 20.6; upgrade |
| `password authentication failed` / `Tenant or user not found` | Wrong password, unencoded special characters, or wrong pooler username; recopy the session pooler URI |
| `ENOTFOUND` / `ETIMEDOUT` to Supabase | Used the direct host; use the session pooler string |
| `ECONNREFUSED 127.0.0.1:6379` | Redis container not running (`docker compose up -d`) |
| `/api/workers` shows 0 | No worker process running; heartbeat keys expire 5s after a worker stops |
| Scheduled/report job never completes | No LOW worker running (scheduled and routine jobs score LOW) |
| Normal request stuck | No MEDIUM worker running |
| `.env` appears in `git status` | Fix `.gitignore` before any commit; never commit secrets |

---

## 23. Quick glossary

- **Priority engine:** backend function converting context into a score and HIGH/MEDIUM/LOW.
- **Queue:** Redis-backed list of waiting jobs managed by BullMQ (`high`, `medium`, `low`).
- **Worker pool:** pods consuming exactly one queue, pinned to one node.
- **Taint / toleration / nodeSelector:** Kubernetes mechanisms that keep other pods off a node and pin worker pods onto it.
- **Heartbeat:** short-lived Redis key a worker refreshes every 2s so the dashboard can count live workers.
- **Stalled job:** a job whose worker died mid-run; BullMQ re-delivers it after the lock expires.
- **SLA window:** default deadline per document category used to compute deadline pressure.
