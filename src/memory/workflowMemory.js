const path = require("path");

const { readJson, writeJson } = require("../utils/json");
const { hash, normalize } = require("../utils/fingerprint");

// A workflow is the action sequence that completed a whole task on a host.
// Replaying a known-good workflow is the cheapest path there is: zero LLM calls.
class WorkflowMemory {

    constructor(file = path.join(__dirname, "workflows.json")) {

        this.file = file;
        this.data = readJson(this.file, {});

    }

    static key(host, task) {

        return `${host}::${hash(normalize(task))}`;

    }

    get(host, task) {

        return this.data[WorkflowMemory.key(host, task)] || null;

    }

    save(host, task, actions) {

        if (!host || !task || !Array.isArray(actions) || actions.length === 0) {
            return null;
        }

        const key = WorkflowMemory.key(host, task);

        const existing = this.data[key];

        const steps = actions.map(action => ({
            action: action.action,
            fingerprint: action.element?.fingerprint || null,
            source: action.source || null,
            value: action.source ? null : (action.value ?? null),
            url: action.url || null,
            goal: action.goal || null
        }));

        this.data[key] = {
            host,
            task,
            steps,
            runs: (existing?.runs || 0) + 1,
            success: (existing?.success || 0) + 1,
            updated: new Date().toISOString()
        };

        writeJson(this.file, this.data);

        return this.data[key];

    }

    fail(host, task) {

        const key = WorkflowMemory.key(host, task);

        if (!this.data[key]) {
            return;
        }

        this.data[key].runs++;
        this.data[key].updated = new Date().toISOString();

        writeJson(this.file, this.data);

    }

    confidence(host, task) {

        const entry = this.get(host, task);

        if (!entry) {
            return 0;
        }

        return (entry.success + 1) / (entry.runs + 2);

    }

}

module.exports = WorkflowMemory;
