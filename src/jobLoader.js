const fs = require("fs");

const config = require("./config");
const logger = require("./utils/logger");

// Jobs come from a file or from any HTTP endpoint (n8n webhook, API, a Sheets
// proxy — they all just return JSON).
class JobLoader {

    constructor(options = {}) {

        this.source = options.source || config.jobs.source;
        this.file = options.file || config.jobs.file;
        this.url = options.url || config.jobs.url;
        this.timeout = options.timeout || config.jobs.timeout;
        this.jobs = options.jobs || null;
        this.index = 0;

    }

    static validate(job) {

        if (!job || typeof job !== "object") {
            throw new Error("Job is not an object.");
        }

        if (!job.url) {
            throw new Error("Job is missing 'url'.");
        }

        if (!job.task) {
            throw new Error("Job is missing 'task'.");
        }

        return job;

    }

    async load() {

        if (this.jobs) {
            return this.jobs;
        }

        this.jobs = this.source === "http"
            ? await this.fromHttp()
            : this.fromFile();

        this.jobs.forEach(JobLoader.validate);

        logger.info(`Loaded ${this.jobs.length} job(s) from ${this.source}.`);

        return this.jobs;

    }

    fromFile() {

        if (!fs.existsSync(this.file)) {
            throw new Error(`Jobs file not found: ${this.file}`);
        }

        const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));

        const jobs = Array.isArray(parsed) ? parsed : parsed.jobs;

        if (!Array.isArray(jobs) || jobs.length === 0) {
            throw new Error("No jobs available.");
        }

        return jobs;

    }

    async fromHttp() {

        if (!this.url) {
            throw new Error("JOB_SOURCE is 'http' but JOB_URL is not set.");
        }

        // Without a ceiling, an n8n webhook that never answers hangs the run
        // forever — and under the server it holds a queue slot with it.
        const response = await fetch(this.url, {
            signal: AbortSignal.timeout(this.timeout)
        });

        if (!response.ok) {
            throw new Error(`Job source ${this.url} returned ${response.status}`);
        }

        const payload = await response.json();

        const jobs = Array.isArray(payload) ? payload : (payload.jobs || [payload]);

        if (jobs.length === 0) {
            throw new Error("Job source returned no jobs.");
        }

        return jobs;

    }

    async all() {

        return this.load();

    }

    // Sequential cursor over the loaded jobs.
    async next() {

        const jobs = await this.load();

        return this.index < jobs.length ? jobs[this.index++] : null;

    }

}

module.exports = JobLoader;
