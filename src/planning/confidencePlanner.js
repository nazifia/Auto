const logger = require("../utils/logger");
const config = require("../config");
const { pageSignature } = require("../utils/fingerprint");

// The reason the agent gets fast: if this exact goal on this exact page shape
// worked before, replay it and skip the LLM entirely.
class ConfidencePlanner {

    constructor(plannerCache, confidenceModel, threshold = config.agent.confidenceThreshold) {

        this.cache = plannerCache;
        this.model = confidenceModel;
        this.threshold = threshold;

    }

    signature(page) {

        return pageSignature(page);

    }

    // Returns actions when confident, otherwise null (caller asks the LLM).
    propose(host, goal, page) {

        if (!this.cache) {
            return null;
        }

        const signature = this.signature(page);

        const entry = this.cache.get(host, goal, signature);

        if (!entry) {
            return null;
        }

        const actions = this.cache.hydrate(entry, page);

        if (!actions) {

            logger.debug("Cached plan no longer matches the page.");

            return null;

        }

        const cacheConfidence = this.cache.confidence(host, goal, signature);

        const confidence = this.model
            ? this.model.plan(host, actions, cacheConfidence)
            : cacheConfidence;

        if (confidence < this.threshold) {

            logger.debug(`Cached plan confidence ${confidence.toFixed(2)} below ${this.threshold}.`);

            return null;

        }

        logger.info(`✓ Cached plan reused (confidence ${confidence.toFixed(2)}, no LLM call).`);

        this.cache.hit(host, goal, signature);

        return { actions, confidence, signature };

    }

    record(host, goal, signature, ok) {

        if (this.cache && signature) {
            this.cache.record(host, goal, signature, ok);
        }

    }

}

module.exports = ConfidencePlanner;
