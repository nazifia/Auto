const path = require("path");

const { readJson, writeJson } = require("../utils/json");
const logger = require("../utils/logger");

// Run-level counters. The cacheHits/llmCalls ratio is the number that tells you
// whether the agent is actually getting cheaper over time.
class Statistics {

    constructor(file = path.join(__dirname, "..", "memory", "statistics.json")) {

        this.file = file;

        this.run = {
            steps: 0,
            actions: 0,
            failures: 0,
            goals: 0,
            llmCalls: 0,
            cacheHits: 0,
            startedAt: Date.now()
        };

    }

    add(field, amount = 1) {

        this.run[field] = (this.run[field] || 0) + amount;

    }

    get cacheRate() {

        const total = this.run.llmCalls + this.run.cacheHits;

        return total === 0 ? 0 : this.run.cacheHits / total;

    }

    report(meta = {}) {

        const summary = {
            ...meta,
            ...this.run,
            durationMs: Date.now() - this.run.startedAt,
            cacheRate: Number(this.cacheRate.toFixed(3)),
            finishedAt: new Date().toISOString()
        };

        delete summary.startedAt;

        const history = readJson(this.file, []);

        history.push(summary);

        writeJson(this.file, history.slice(-100));

        logger.section("RUN STATISTICS");
        logger.table([summary]);

        return summary;

    }

}

module.exports = Statistics;
