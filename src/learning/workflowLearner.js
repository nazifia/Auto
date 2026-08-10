const logger = require("../utils/logger");

// Stores the full action sequence of a completed job so a future run of the
// same task on the same host has a proven path to compare against.
class WorkflowLearner {

    constructor(workflowMemory) {

        this.memory = workflowMemory;

    }

    success(host, task, actions) {

        if (!this.memory) {
            return null;
        }

        const entry = this.memory.save(host, task, actions);

        if (entry) {
            logger.info(`✓ Workflow learned (${entry.steps.length} steps, ${entry.success}/${entry.runs} successful).`);
        }

        return entry;

    }

    failure(host, task) {

        if (this.memory) {
            this.memory.fail(host, task);
        }

    }

    known(host, task) {

        return this.memory ? this.memory.get(host, task) : null;

    }

    confidence(host, task) {

        return this.memory ? this.memory.confidence(host, task) : 0;

    }

}

module.exports = WorkflowLearner;
