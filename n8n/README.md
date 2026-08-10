# n8n integration

`browser-agent.json` is an importable workflow:

```
Webhook trigger ─┐
Manual Trigger  ─┼─> Start job ─> Wait for result ─> Job succeeded? ─> Summarise goals
Every day 07:00 ─┘   (POST /run)   (parks execution)                └─> Report failure
```

`Start job` sends `callbackUrl: {{ $execution.resumeUrl }}`. The agent answers `202`
immediately, runs the browser, then POSTs the result to that URL — no held socket,
no polling. Credentials never enter n8n: the body passes `${PA_USERNAME}` through
literally and the agent resolves it from its own `.env`.

## Setup

1. Agent server: `npm run serve`. `AGENT_TOKEN` and `HOST=0.0.0.0` live in `.env`
   (the container cannot reach host loopback). Binding `0.0.0.0` exposes `/run`
   to the LAN — the token is the only thing guarding it.
2. n8n credential — **Header Auth**, name `Agent Token`, header `x-auth-token`,
   value = `AGENT_TOKEN`.
3. Import: `docker cp browser-agent.json <container>:/tmp/wf.json`
   then `docker exec <container> n8n import:workflow --input=/tmp/wf.json`,
   then restart the container so the webhook registers.
4. Fire it: `curl -X POST http://127.0.0.1:5678/webhook/run-browser-job`

Edit the task, url and variables in the `Start job` node's JSON body.

## Gotchas hit while wiring this up

- The Wait node's resume webhook defaults to **GET**. The agent POSTs, so
  `httpMethod: POST` is set on that node — without it every callback 404s and
  the execution hangs in `waiting` forever.
- `import:workflow` overwrites the active flag, so the JSON carries
  `"active": true`. A restart is still needed for n8n to register the webhook.
- From Docker, the agent is `http://host.docker.internal:<PORT>`, never `127.0.0.1`.
  Both workflows point at `:3001` because the ChatGPT desktop app squats on
  `0.0.0.0:3000` here — it holds the port in `Bound` state, so `netstat` shows no
  listener while `listen()` still fails with `EADDRINUSE`. `PORT=3001` in `.env`
  and the `Start job` node's URL have to agree.
- A `429` from `/run` means the queue is full — retry later.
- Jobs on the same host never run in parallel (one session file, one login);
  different hosts do, up to `CONCURRENCY`.

## Jobs from a Google Sheet

`sheets-credentials.json` is the same flow with a spreadsheet in front:

```
Read credentials sheet ─> Rows to jobs ─> Start jobs ─> Wait ─> succeeded?
```

Sheet columns: `URL`, `USERNAME`, `PASSWORD_REF` (or `PASSWORD`), `SUBMIT`,
`TAB`, `BUTTON`, and optional `ENABLED`. Header matching ignores case, spaces
and underscores, so `Password Ref` and `password_ref` are the same column. All
rows go out as one `jobs: [...]` array, so the Wait node parks once for the
whole batch, and each row's `USERNAME` comes back as the result's `name`.

`SUBMIT`, `TAB` and `BUTTON` become the row's goals — the sheet says which
button to press, so no task-planner LLM call happens. `SUBMIT` defaults to
`Log in`; `TAB` and `BUTTON` are each dropped from the plan when blank.
`ENABLED` set to `no`, `false`, `0` or `off` skips the row.

`PASSWORD_REF` holds the **name** of an env key on the agent box (`PA_PASSWORD`),
not the password. The Code node turns it into `${PA_PASSWORD}` and the agent
resolves it from its own `.env` — the secret never reaches the sheet, Google, or
n8n. A literal `PASSWORD` column also works and is read as-is; anyone with the
sheet, the Google account, or an n8n execution log then has the password, so keep
that for logins you would not mind losing. A row with neither fails the whole
batch up front rather than running a browser that stalls on the login form.

Setup: create a Google Sheets OAuth2 credential in n8n, open the
`Read credentials sheet` node, pick it, and set the spreadsheet id. Then
`npm run deploy:flow n8n/sheets-credentials.json`.

The Wait node here gives up after 2 hours instead of parking forever, so a
callback that never lands ends up in `Report failures` rather than in a
`waiting` execution nobody looks at. Rows on the same site run one at a time —
raise that limit if a batch takes longer than 2 hours end to end.

## The other direction

n8n can also serve jobs instead of triggering them: set `JOB_SOURCE=http` and
`JOB_URL=<n8n webhook>` in `.env`, and `npm start` pulls its job list from there.
