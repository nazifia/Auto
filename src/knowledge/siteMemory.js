const path = require("path");

const { readJson, writeJson } = require("../utils/json");

// Per-host run statistics: how often this site works, and what it cost.
class SiteMemory {

    constructor(file = path.join(__dirname, "sites", "_stats.json")) {

        this.file = file;
        this.data = readJson(this.file, {});

    }

    entry(host) {

        this.data[host] = this.data[host] || {
            visits: 0,
            goals: 0,
            failures: 0,
            llmCalls: 0,
            cacheHits: 0,
            lastVisit: null
        };

        return this.data[host];

    }

    record(host, field, amount = 1) {

        if (!host) {
            return;
        }

        const entry = this.entry(host);

        entry[field] = (entry[field] || 0) + amount;
        entry.lastVisit = new Date().toISOString();

        writeJson(this.file, this.data);

    }

    get(host) {

        return this.data[host] || null;

    }

    all() {

        return this.data;

    }

}

module.exports = SiteMemory;
