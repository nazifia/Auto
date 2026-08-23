# n8n integration

`browser-agent.json` is an importable workflow:

```
Webhook trigger     ─┐
Manual Trigger      ─┼─> Start job ─> Wait for result ─> Job succeeded? ─> Summarise goals
Every day 07:00 UTC ─┘   (POST /run)   (parks execution)                └─> Report failure
```

`Start job` sends `callbackUrl: {{ $execution.resumeUrl }}`. The agent answers `202`
immediately, runs the browser, then POSTs the result to that URL — no held socket,
no polling. Credentials never enter n8n: the body passes `${PA_USERNAME}` through
literally and the agent resolves it from its own `.env`.

## Setup

1. Agent server: `npm run serve` for a one-off, or the `N8NBrowserAgent` service
   for a permanent one (see below). `AGENT_TOKEN` and `PORT` live in `.env`.
   `HOST=127.0.0.1`: n8n is on this host now, so `/run` never needs to leave
   loopback. Only set `0.0.0.0` if n8n moves back into a container — that puts
   `/run` on the LAN with `AGENT_TOKEN` as the only guard.
2. n8n credential — **Header Auth**, name `Agent Token`, header `x-auth-token`,
   value = `AGENT_TOKEN`.
3. Import (elevated, service stopped so sqlite is not locked):
   `n8n import:workflow --input n8n\browser-agent.json`, then
   `n8n update:workflow --id browserAgentRunJob --active true`, then start the
   service again. **`import:workflow` deactivates what it imports** — skip the
   update step and both the webhook and the schedule go silent.
4. Fire it: `curl -X POST http://127.0.0.1:5678/webhook/run-browser-job`

Edit the task, url and variables in the `Start job` node's JSON body.

## Running on a schedule

The `Every day 07:00 UTC` trigger is enabled, so the flow runs itself daily.
It fires at 07:00 UTC only because the workflow pins `settings.timezone` to
`Etc/UTC`; without that, n8n applies its `America/New_York` default and the node
runs four hours late. Keep that key in any flow copied from this one.
Both halves of the chain are Windows services, auto-start, LocalSystem, restart
on crash — installed from an **elevated** PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1        # N8NBrowserAgent
powershell -ExecutionPolicy Bypass -File scripts\install-n8n-service.ps1    # N8N
```

Both take `-Remove`. `install-service.ps1` also deletes the older
Startup-folder script, which only ran at logon and would fight the service for
the port.

| | `N8NBrowserAgent` | `N8N` |
|---|---|---|
| runs | `src/server.js` on 3001 | `n8n start` on 5678 |
| logs | `logs/service.log` | `C:\ProgramData\n8n\logs\n8n.log` |
| data | this project | `C:\ProgramData\n8n\.n8n` |

**Docker is out of the chain.** n8n used to run in a container, but Docker
Desktop starts at user *logon* — no logon, no container, no trigger, and the
agent sat there with nothing calling it. n8n now runs from the npm package
(`npm install -g n8n@2.32.7`, pinned to the version the container had so the
sqlite migrations line up). The container's `/home/node/.n8n` was copied whole
to `C:\ProgramData\n8n\.n8n`, encryption key included, so credentials still
decrypt. The old container is stopped, not deleted, and its restart policy is
`no` — it will not come back and fight for 5678.

Because both sides are now on the host, `Start job` posts to
`http://127.0.0.1:3001/run`. Going back to a container means changing that back
to `host.docker.internal`.

Four things the installers work around, none of them obvious:

- **nssm.** Windows cannot supervise a plain console program as a service —
  `sc.exe` expects a binary that answers the SCM, which `node` does not. The
  scripts install nssm through winget to act as the wrapper. Its output has to
  be sent to `Out-Null`, or the banner text rides out on the pipeline as the
  function's return value and the caller tries to execute it as a path.
- **LocalSystem has its own profile**, so Playwright would hunt for browsers
  under `C:\Windows\System32\config\systemprofile` and find none. The agent
  service gets `PLAYWRIGHT_BROWSERS_PATH` pointed at this user's
  `ms-playwright`.
- **nvm4w.** `C:\nvm4w\nodejs\node.exe` is a symlink that moves on every
  `nvm use`. Both services are pinned to the resolved path
  (`...\nvm\v24.18.0\node.exe`) so switching node versions cannot silently
  change what runs — re-run the installers after an upgrade.
- **`N8N_USER_FOLDER` is the parent of `.n8n`**, not `.n8n` itself. Point it at
  `C:\ProgramData\n8n` and n8n reads `C:\ProgramData\n8n\.n8n`.

**No community nodes in that data folder.** `n8n-nodes-playwright` and
`n8n-nodes-browser-use-cloud` were installed there once and both are gone now,
removed by `scripts/remove-community-nodes.ps1`. The Playwright one is why: it
requires `scripts/setup-browsers.js` from the top of `Playwright.node.js`, so
the setup runs when n8n *loads node types*, not when the node executes. Every
single start deleted and re-copied ~430 MB of browsers, and its `catch` calls
`process.exit(1)` — from inside the n8n process. Under the service the copy
source is LocalSystem's `ms-playwright`, the copy failed partway, and n8n
restarted every ~15 seconds without ever staying bound to 5678. No workflow
used either node; the browser work belongs to the agent, not to n8n. Reinstall
one only if a workflow genuinely needs it, and expect that startup cost back.

Also run the n8n CLI **elevated** — as a normal user it hits `EPERM` on files
the service wrote as SYSTEM.

`HEADLESS=true` is not a preference here, it is load-bearing. LocalSystem runs
in session 0, which has no desktop, and a headful chromium there does not draw
an invisible window -- it hangs, and `page.goto` burns its whole timeout on
every run while the same navigation from a normal user session finishes in a
few seconds. Set `HEADLESS=false` only for `npm run serve` in your own session.

## Gotchas hit while wiring this up

- **Editing a workflow is not publishing it.** n8n 2.x keeps a draft in
  `workflow_entity` and runs the *published version* recorded in
  `workflow_history`, and the public API's `GET /workflows/{id}` returns the
  draft -- so the API can report the change you just made while the trigger
  keeps running the old one. `POST /workflows/{id}/activate` on an already
  published workflow is a no-op, and `versionId` is read-only, so the API
  cannot mint a version directly. A `PUT` whose body differs from the current
  draft does: it bumps `versionId` and republishes. `deploy:flow` therefore
  silently does nothing if the draft already matches the file -- which is
  exactly what happens after someone edits the sqlite row by hand. Check
  `activeVersionId`, then read that version back with
  `GET /workflows/{id}/{versionId}`, before believing a deploy landed.
- The Wait node's resume webhook defaults to **GET**. The agent POSTs, so
  `httpMethod: POST` is set on that node — without it every callback 404s and
  the execution hangs in `waiting` forever.
- `import:workflow` **deactivates** the workflow it imports, whatever the JSON's
  `"active"` says. Follow every import with `update:workflow --active true` and
  a restart, or the webhook is not registered and the schedule never fires.
- After a restart the webhook takes a few seconds longer to register than
  `/healthz` takes to answer `200`. A `404` on the first POST is not a failure —
  retry before concluding the flow is broken.
- **`n8n does not have permission to use port 5678`** with nothing listening on
  it is Hyper-V, not another process. winnat is handed a block of dynamic TCP
  ports at boot and the block is re-rolled on every reboot, so a port that
  worked yesterday can be inside it today — `netsh interface ipv4 show
  excludedportrange protocol=tcp` lists the ranges. The fix is a persistent
  single-port exclusion, which takes 5678 out of the pool the lottery draws
  from while leaving an explicit bind to it legal. winnat must be down to edit
  the list; `scripts\remove-community-nodes.ps1` does this.
- Both workflows point at `:3001` because the ChatGPT desktop app squats on
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
