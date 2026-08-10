const logger = require("../utils/logger");

// When a cached plan fails, the cache is wrong — drop it and force a fresh
// LLM plan for the next iteration.
class Replanner {

    constructor(planner) {

        this.planner = planner;
        this.forceFresh = false;

    }

    invalidate(host, goal, signature) {

        if (signature) {
            this.planner.forget(host, goal, signature);
        }

        this.forceFresh = true;

        logger.warn("Replanner: cached plan discarded, next plan will be fresh.");

    }

    // One-shot flag: reading it clears it.
    consume() {

        const value = this.forceFresh;

        this.forceFresh = false;

        return value;

    }

}

module.exports = Replanner;
