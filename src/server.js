const http = require("http");
const crypto = require("crypto");

const config = require("./config");
const logger = require("./utils/logger");
const JobLoader = require("./jobLoader");
const Queue = require("./queue");
const { Agent } = require("./agent");

// Inbound half of the n8n integration: n8n POSTs a job here and gets the
// result back. The outbound half (pulling jobs from an n8n webhook) already
// lives in jobLoader with JOB_SOURCE=http.
//
//   POST /run        run job(s), reply when finished
//   POST /run        + "callbackUrl": reply 202 now, POST result there later
//   GET  /runs/:id   status of a callback-mode run
//   GET  /health     liveness, plus whether a job is in flight

const BODY_LIMIT = 1024 * 1024;

const runs = new Map();

// One Agent for every run. Its memories (element, workflow, site, locator
// cache) are loaded once and written whole-file, so a second instance would
// overwrite the first one's learning. Sharing the objects merges it instead.
// Both live on the settings object, so each server gets its own.
function agentFor(options) {

    options.agent = options.agent || new Agent(options);

    return options.agent;

}

function queueFor(options) {

    options.queue = options.queue || new Queue({
        concurrency: options.concurrency,
        maxPending: options.maxQueue
    });

    return options.queue;

}

function hostOf(job) {

    try {
        return new URL(job.url).hostname || null;
    }
    catch {
        return null;
    }

}

function remember(id, entry) {

    runs.set(id, entry);

    // Keep the last 50 runs so a slow n8n poll can still find its result.
    while (runs.size > 50) {
        runs.delete(runs.keys().next().value);
    }

    return entry;

}

function send(res, status, body) {

    const payload = JSON.stringify(body);

    res.writeHead(status, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload)
    });

    res.end(payload);

}

function readBody(req) {

    return new Promise((resolve, reject) => {

        const chunks = [];
        let size = 0;

        req.on("data", chunk => {

            size += chunk.length;

            if (size > BODY_LIMIT) {

                req.destroy();

                reject(new Error("Request body too large."));

                return;

            }

            chunks.push(chunk);

        });

        req.on("end", () => {

            const raw = Buffer.concat(chunks).toString("utf8").trim();

            if (!raw) {
                return resolve({});
            }

            try {
                resolve(JSON.parse(raw));
            }
            catch {
                reject(new Error("Body is not valid JSON."));
            }

        });

        req.on("error", reject);

    });
}

// This endpoint drives a real browser with real stored credentials, so the
// token check is not optional once the server is reachable off-box.
function authorized(req, token) {

    if (!token) {
        return true;
    }

    const header = req.headers["x-auth-token"]
        || String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");

    const given = Buffer.from(String(header));
    const want = Buffer.from(token);

    return given.length === want.length && crypto.timingSafeEqual(given, want);

}

function jobsFrom(payload) {

    const jobs = Array.isArray(payload)
        ? payload
        : (payload.jobs || [payload.job || payload]);

    if (!Array.isArray(jobs) || jobs.length === 0) {
        throw new Error("No jobs in request.");
    }

    jobs.forEach(JobLoader.validate);

    return jobs;

}

// The caller chooses this URL and the server will POST to it, so it is an SSRF
// lever: anything reachable from the agent host is reachable through /run.
// Rejecting here rather than in deliver() means a bad URL costs a 400, not a
// browser run whose result then has nowhere to go.
function callbackFrom(payload, allowed = config.server.callbackHosts) {

    if (!payload.callbackUrl) {
        return null;
    }

    let parsed;

    try {
        parsed = new URL(payload.callbackUrl);
    }
    catch {
        throw new Error("callbackUrl is not a valid URL.");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("callbackUrl must be http(s).");
    }

    if (allowed.length > 0 && !allowed.includes(parsed.hostname)) {
        throw new Error(`callbackUrl host is not allowed: ${parsed.hostname}`);
    }

    return payload.callbackUrl;

}

// Every job is queued on its own, keyed by host: jobs on different sites run in
// parallel, jobs on the same site take turns. Results keep the request's order.
async function runJobs(jobs, options) {

    const agent = agentFor(options);
    const jobQueue = queueFor(options);

    const results = await Promise.all(jobs.map(job =>

        jobQueue.push(hostOf(job), () => agent.runJob(job))
            .catch(error => {

                logger.error("JOB FAILED:", error.message);

                return { ok: false, name: job.name || null, url: job.url, error: error.message };

            })

    ));

    return { ok: results.every(result => result.ok), results };

}

// n8n parks the execution only after its Wait node runs, so a job that fails
// in seconds can beat it there and get a 404. Without retries that result is
// gone for good — the run is finished and nothing will send it again.
async function deliver(url, body, attempts = 4) {

    const token = config.server.callbackToken;

    for (let attempt = 1; attempt <= attempts; attempt++) {

        try {

            const response = await fetch(url, {
                signal: AbortSignal.timeout(15000),
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    // Deliberately NOT the inbound token: the callback URL is
                    // caller-supplied, so sending our own would leak it.
                    ...(token ? { "x-auth-token": token } : {})
                },
                body: JSON.stringify(body)
            });

            if (response.ok) {

                logger.info(`Callback delivered (${response.status}).`);

                return true;

            }

            logger.warn(`Callback ${url} returned ${response.status} (${attempt}/${attempts})`);

        }
        catch (error) {

            logger.warn(`Callback failed (${attempt}/${attempts}): ${error.message}`);

        }

        if (attempt < attempts) {
            await new Promise(resolve => setTimeout(resolve, attempt * 3000));
        }

    }

    // The result still lives at GET /runs/:id for anyone who asks.
    logger.error(`Callback ${url} gave up after ${attempts} attempts.`);

    return false;

}

async function handle(req, res, options) {

    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") {

        const jobQueue = queueFor(options);

        return send(res, 200, {
            ok: true,
            running: jobQueue.running,
            queued: jobQueue.queued,
            concurrency: jobQueue.concurrency
        });

    }

    if (!authorized(req, options.token)) {
        return send(res, 401, { ok: false, error: "Unauthorized." });
    }

    if (req.method === "GET" && url.pathname.startsWith("/runs/")) {

        const run = runs.get(url.pathname.slice("/runs/".length));

        return run
            ? send(res, 200, run)
            : send(res, 404, { ok: false, error: "Unknown run id." });

    }

    if (req.method !== "POST" || url.pathname !== "/run") {
        return send(res, 404, { ok: false, error: "Not found." });
    }

    let payload;
    let jobs;
    let callbackUrl;

    try {
        payload = await readBody(req);
        jobs = jobsFrom(payload);
        callbackUrl = callbackFrom(payload, options.callbackHosts || []);
    }
    catch (error) {
        return send(res, 400, { ok: false, error: error.message });
    }

    const jobQueue = queueFor(options);

    if (jobQueue.queued + jobs.length > jobQueue.maxPending) {
        return send(res, 429, { ok: false, error: "Queue is full — retry later." });
    }

    const id = crypto.randomUUID();

    const finished = runJobs(jobs, options)
        .catch(error => ({ ok: false, error: error.message, results: [] }))
        .then(outcome => remember(id, { id, status: "done", ...outcome }));

    // Browser jobs run for minutes. Callback mode keeps n8n off a hanging
    // socket: reply now, POST the result to its Webhook node when done.
    if (callbackUrl) {

        remember(id, { id, status: "running", ok: null, results: [] });

        finished.then(outcome => deliver(callbackUrl, outcome));

        return send(res, 202, { ok: true, id, status: "running" });

    }

    const outcome = await finished;

    return send(res, outcome.ok ? 200 : 500, outcome);

}

function start(options = {}) {

    const settings = { ...config.server, ...options };

    const local = /^(127\.0\.0\.1|localhost|::1)$/.test(settings.host);

    if (!settings.token && !local) {

        throw new Error(
            "AGENT_TOKEN must be set when binding to a non-local host — "
            + "/run executes browser automation with stored credentials."
        );

    }

    const server = http.createServer((req, res) => {

        handle(req, res, settings).catch(error => {

            logger.error("Request failed:", error.message);

            send(res, 500, { ok: false, error: error.message });

        });

    });

    // A sync run holds the socket for as long as the browser job takes.
    server.timeout = 0;
    server.requestTimeout = 0;
    server.headersTimeout = 60000;

    server.listen(settings.port, settings.host, () => {

        logger.info(`Listening on http://${settings.host}:${settings.port} (POST /run)`);

        if (!settings.token) {
            logger.warn("No AGENT_TOKEN set — /run is unauthenticated on localhost.");
        }

    });

    return server;

}

if (require.main === module) {
    start();
}

module.exports = { start, handle, jobsFrom, callbackFrom, runJobs };
