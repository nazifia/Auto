const path = require("path");

const { readJson, writeJson } = require("../utils/json");
const { hash, normalize } = require("../utils/fingerprint");

// Caches "what did the LLM decide for this goal on this exact page shape".
// Actions are stored by fingerprint, not elementId, because ids are per-observation.
class PlannerCache {

    constructor(file = path.join(__dirname, "plannerCache.json")) {

        this.file = file;
        this.data = readJson(this.file, {});

    }

    static key(host, goal, signature) {

        return hash([host, normalize(goal), signature].join("::"));

    }

    get(host, goal, signature) {

        return this.data[PlannerCache.key(host, goal, signature)] || null;

    }

    save(host, goal, signature, actions) {

        if (!Array.isArray(actions) || actions.length === 0) {
            return;
        }

        const key = PlannerCache.key(host, goal, signature);

        const existing = this.data[key];

        this.data[key] = {
            host,
            goal,
            signature,
            steps: actions.map(action => ({
                action: action.action,
                fingerprint: action.element?.fingerprint || null,
                source: action.source || null,
                value: action.source ? null : (action.value ?? null),
                key: action.key || null,
                ms: action.ms || null,
                url: action.url || null,
                when: action.when || null
            })),
            hits: existing?.hits || 0,
            success: existing?.success || 0,
            fail: existing?.fail || 0,
            updated: new Date().toISOString()
        };

        writeJson(this.file, this.data);

    }

    // Rebuild cached steps against the current page. Any missing element is a miss.
    hydrate(entry, page) {

        if (!entry) {
            return null;
        }

        const actions = [];

        for (const step of entry.steps) {

            const action = {
                action: step.action,
                source: step.source || undefined,
                value: step.value ?? undefined,
                key: step.key || undefined,
                ms: step.ms || undefined,
                url: step.url || undefined,
                when: step.when || undefined,
                cached: true
            };

            if (step.fingerprint) {

                const element = (page.elements || []).find(
                    candidate => candidate.fingerprint === step.fingerprint
                );

                if (!element) {
                    return null;
                }

                action.element = element;

            }

            actions.push(action);

        }

        return actions;

    }

    hit(host, goal, signature) {

        const key = PlannerCache.key(host, goal, signature);

        if (this.data[key]) {

            this.data[key].hits++;

            writeJson(this.file, this.data);

        }

    }

    record(host, goal, signature, ok) {

        const key = PlannerCache.key(host, goal, signature);

        if (!this.data[key]) {
            return;
        }

        this.data[key][ok ? "success" : "fail"]++;

        writeJson(this.file, this.data);

    }

    confidence(host, goal, signature) {

        const entry = this.get(host, goal, signature);

        if (!entry) {
            return 0;
        }

        return (entry.success + 1) / (entry.success + entry.fail + 2);

    }

    forget(host, goal, signature) {

        const key = PlannerCache.key(host, goal, signature);

        if (this.data[key]) {

            delete this.data[key];

            writeJson(this.file, this.data);

        }

    }

}

module.exports = PlannerCache;
