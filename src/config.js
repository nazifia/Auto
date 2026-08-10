const path = require("path");

require("dotenv").config({
    path: path.join(__dirname, "..", ".env")
});

const bool = (value, fallback) =>
    value === undefined ? fallback : /^(1|true|yes|on)$/i.test(value);

const num = (value, fallback) =>
    value === undefined || value === "" ? fallback : Number(value);

const root = path.join(__dirname, "..");

module.exports = {

    root,

    browser: {

        headless: bool(process.env.HEADLESS, false),

        slowMo: num(process.env.SLOW_MO, 150),

        timeout: num(process.env.TIMEOUT, 30000),

        viewport: { width: 1366, height: 768 }

    },

    ai: {

        provider: process.env.AI_PROVIDER || "openrouter",

        model: process.env.AI_MODEL
            || process.env.OPENROUTER_MODEL
            || "openai/gpt-oss-20b:free",

        apiKey: process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY,

        url: process.env.AI_URL || "https://openrouter.ai/api/v1/chat/completions",

        temperature: num(process.env.AI_TEMPERATURE, 0),

        maxRetries: num(process.env.AI_MAX_RETRIES, 3),

        // Per request. A stalled call otherwise hangs the job with no ceiling.
        timeout: num(process.env.AI_TIMEOUT, 90000)

    },

    agent: {

        maxSteps: num(process.env.MAX_STEPS, 60),

        maxRetries: num(process.env.MAX_RETRIES, 3),

        maxGoalAttempts: num(process.env.MAX_GOAL_ATTEMPTS, 8),

        settleMs: num(process.env.SETTLE_MS, 700),

        // Above this, cached plans run without asking the LLM.
        confidenceThreshold: num(process.env.CONFIDENCE_THRESHOLD, 0.8),

        useCache: bool(process.env.USE_CACHE, true),

        screenshotOnFailure: bool(process.env.SCREENSHOT_ON_FAILURE, true)

    },

    vision: {

        // Off by default: image tokens cost far more than the DOM shortlist.
        enabled: bool(process.env.VISION, false),

        // Must be a multimodal model. Falls back to the main model.
        model: process.env.VISION_MODEL || process.env.AI_MODEL,

        fullPage: bool(process.env.VISION_FULL_PAGE, false)

    },

    jobs: {

        // file | http  (http covers n8n webhooks and any REST endpoint)
        source: process.env.JOB_SOURCE || "file",

        file: process.env.JOB_FILE || path.join(__dirname, "jobs", "jobs.json"),

        url: process.env.JOB_URL,

        // Ceiling on the JOB_URL fetch. A silent webhook must not hang the run.
        timeout: num(process.env.JOB_TIMEOUT, 30000)

    },

    server: {

        // Inbound side of n8n: an HTTP Request node POSTs a job to /run.
        port: num(process.env.PORT, 3000),

        host: process.env.HOST || "127.0.0.1",

        // Required to bind anywhere but localhost.
        token: process.env.AGENT_TOKEN,

        // Browser jobs in parallel. Each one is a chromium — raise with RAM in
        // mind. Same-host jobs still take turns, whatever this says.
        concurrency: num(process.env.CONCURRENCY, 2),

        // Beyond this many waiting jobs, /run answers 429 instead of growing.
        maxQueue: num(process.env.MAX_QUEUE, 50),

        // Sent on callbacks to n8n. Separate on purpose — the callback URL
        // comes from the caller, so the inbound token must not go out with it.
        callbackToken: process.env.CALLBACK_TOKEN,

        // Optional allowlist of hostnames /run will POST a result to. Empty
        // means any http(s) host. The caller picks the callback URL, so on a
        // non-local bind this is what stops /run being an SSRF lever.
        callbackHosts: String(process.env.CALLBACK_HOSTS || "")
            .split(",")
            .map(host => host.trim())
            .filter(Boolean)

    },

    ranking: {

        topN: num(process.env.RANK_TOP_N, 25)

    },

    paths: {

        logs: path.join(root, "logs"),

        screenshots: path.join(root, "screenshots")

    }

};
