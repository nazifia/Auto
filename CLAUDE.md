# Automation — AI browser agent with an n8n front door

A Playwright agent that takes a plain-English `task` for a URL, plans goals with an
LLM (OpenRouter), executes them, and learns from the result. n8n triggers it over
HTTP; credentials never leave this project's `.env`.

```
n8n ── POST /run ──> src/server.js ──> Queue ──> Agent ──> Playwright
    <── callback ────────────────────────────────┘
```

## Commands

```bash
npm start          # run the jobs in src/jobs/jobs.json once
npm run serve      # HTTP server on PORT (default 3000): POST /run
npm test           # node --test tests/*.test.js
npm run deploy:flow n8n/browser-agent.json   # push a workflow to n8n (upsert + activate)
```

## Adding an automation

Most new automations need **no new n8n workflow** — only a new job object. A job is:

```json
{
  "url": "https://example.com/login",
  "task": "Log in and download this month's invoice",
  "goals": [
    { "goal": "Log in", "done": "Dashboard is visible" }
  ],
  "variables": { "USERNAME": "${EXAMPLE_USER}", "PASSWORD": "${EXAMPLE_PASS}" },
  "session": true,
  "browser": { "headless": true }
}
```

- `url` and `task` are the only required fields (`src/jobLoader.js` validates them).
- `goals` is optional. Supplying it skips the task-planner LLM call, which is
  cheaper and far more predictable — prefer it for anything recurring.
- Each goal may carry `done` (a text condition), or `plugin: "api"` with a
  `request` and `saveAs` to run an HTTP call instead of browser steps.
- `variables` values written as `${NAME}` are resolved from **this project's
  `.env`**, not by n8n. Never put a real secret in a job file or an n8n node —
  add `NAME=value` to `.env` and reference `${NAME}`. The job's `variables` map
  is also an allowlist: a planned action can only name a variable the job
  declared, so a page cannot steer the planner into typing an unrelated env var
  into a form. `goto` is limited to `http(s)` for the same reason.
- `session: true` stores cookies after a successful run so later runs skip login.

Where jobs live: `src/jobs/jobs.json` (used by `npm start`), examples in
`src/jobs/examples.json`, or inline in the `Start job` node of an n8n workflow.

## The n8n integration

Two directions, both already built:

- **Inbound** (normal): n8n POSTs a job to `/run` with
  `"callbackUrl": "{{ $execution.resumeUrl }}"`. The server replies `202`
  immediately, runs the browser, then POSTs the result to that URL. The n8n
  Wait node parks the execution meanwhile — no held socket, no polling.
- **Outbound**: set `JOB_SOURCE=http` and `JOB_URL=<n8n webhook>`; `npm start`
  pulls its job list from n8n instead of from a file.

Endpoints in `src/server.js`: `POST /run`, `GET /runs/:id`, `GET /health`.
Auth is the `x-auth-token` header matched against `AGENT_TOKEN`.

New workflow = copy `n8n/browser-agent.json`, change the `Start job` node's
`jsonBody` and the trigger, then `npm run deploy:flow <file>`.

The `browser-agent` flow runs itself daily from its `Every day 07:00 UTC` node.
Nothing sets a timezone on the n8n process, and n8n's fallback is **not** UTC —
it is `America/New_York`, which quietly fired that node at 11:00 UTC. Both flows
now pin `settings.timezone` to `Etc/UTC` in their exported JSON, which overrides
the instance default. The agent has to be listening when the schedule fires.
Both halves run as Windows services, installed elevated
by `scripts/install-service.ps1` (`N8NBrowserAgent`, this project on 3001) and
`scripts/install-n8n-service.ps1` (`N8N`, the npm package on 5678, data in
`C:\ProgramData\n8n\.n8n`). Docker is no longer in the chain — Docker Desktop
only starts at user logon, which a scheduled run cannot rely on. Details and
the migration notes are in `n8n/README.md`.

### Gotchas that cost real time

- The Wait node's resume webhook defaults to **GET**; the agent POSTs. Keep
  `httpMethod: "POST"` on it or every callback 404s and the execution hangs.
- `n8n import:workflow` **deactivates** the workflow it imports. Every import
  needs `n8n update:workflow --id=<id> --active=true` plus a container restart,
  or the webhook and the schedule both go silent.
- n8n and the agent now share a host, so `Start job` posts to
  `http://127.0.0.1:3001/run`. Move n8n back into a container and that has to
  become `host.docker.internal` again, together with `HOST=0.0.0.0` — which
  also puts `/run` on the LAN, where `AGENT_TOKEN` is the only guard (the
  server refuses to start without it on a non-local bind). On loopback,
  `HOST=127.0.0.1`, neither applies.
- `AGENT_TOKEN` (inbound) and `CALLBACK_TOKEN` (outbound) are separate on
  purpose: the callback URL comes from the caller, so the inbound token must
  never be sent out with it. That URL is also an SSRF lever — `/run` will only
  POST to `http(s)`, and `CALLBACK_HOSTS` narrows it to named hosts when set.
- A visible browser is two changes, not one: the job needs
  `"browser": { "headless": false }` (per-job, overriding `HEADLESS`), *and*
  the agent has to run in a logged-in session — `install-service.ps1 -Session`
  parks the LocalSystem service and starts it from the Startup folder instead.
  Session 0 has no desktop, so a headful chromium there is invisible either way.
- `429` from `/run` means the queue is full (`MAX_QUEUE`) — retry later.
- Jobs on the same host never run in parallel (one session file, one login);
  different hosts do, up to `CONCURRENCY`.
- `deploy:flow` upserts by workflow **name**. Renaming a workflow creates a
  second one rather than updating the first.

## Config

Everything is env-driven through `src/config.js` (`.env` at the project root).
Common knobs: `HEADLESS`, `AI_MODEL`, `OPENROUTER_API_KEY`, `MAX_STEPS`,
`CONFIDENCE_THRESHOLD`, `USE_CACHE`, `VISION`, `JOB_SOURCE`, `JOB_TIMEOUT`,
`PORT`, `HOST`, `AGENT_TOKEN`, `CALLBACK_HOSTS`, `CONCURRENCY`, `N8N_URL`,
`N8N_API_KEY`. `.env.example` lists them all with defaults — copy it to `.env`.

Add new settings to `config.js` with a default — modules read config, never
`process.env` directly (the one exception is `scripts/deploy-flow.js`, which is
a deploy tool rather than part of the agent).

## Layout

| Path | Role |
|---|---|
| `src/agent.js` | orchestrates a job: plan, execute, verify, learn |
| `src/server.js` | HTTP front door for n8n |
| `src/planner.js`, `src/planning/` | goal and step planning, validation, verification |
| `src/browser/` | Playwright actions, locator building/resolution, screenshots |
| `src/ranking/`, `src/knowledge/`, `src/learning/` | element scoring, site knowledge, feedback |
| `src/memory/`, `src/cache/` | JSON state on disk: elements, workflows, plans, locators |
| `src/vision/` | optional screenshot/OCR path (`VISION=true`) |
| `src/plugins/` | non-browser goal handlers (`plugin: "api"`) |
| `n8n/` | importable workflow JSON + integration notes |

Memory and cache files are written whole-file, so a second `Agent` instance
would overwrite the first one's learning — the server deliberately shares one
`Agent` across all runs (`agentFor` in `src/server.js`).

## House style

CommonJS, 4-space indent, blank lines between statements inside functions,
`module.exports` at the bottom. Comments explain *why*, not *what*, and are
worth writing where a decision looks arbitrary. Dependencies are limited to
`axios`, `dotenv`, `playwright` — reach for Node's stdlib (`node:http`,
`fetch`, `node:test`) before adding a fourth.
