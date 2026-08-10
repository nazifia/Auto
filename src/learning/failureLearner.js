const logger = require("../utils/logger");
const { elementKey } = require("../utils/fingerprint");

// A failure is data: penalise the element and throw away the locator strategy
// that stopped working, so the next resolve re-discovers it.
class FailureLearner {

    constructor({ elementMemory, locatorCache, siteMemory }) {

        this.elementMemory = elementMemory;
        this.locatorCache = locatorCache;
        this.siteMemory = siteMemory;
        this.failures = [];

    }

    record(host, action, error) {

        if (action?.element?.fingerprint && this.elementMemory) {
            this.elementMemory.fail(host, action.element.fingerprint);
        }

        if (action?.element && this.locatorCache) {
            this.locatorCache.forget(host, elementKey(action.element));
        }

        if (this.siteMemory) {
            this.siteMemory.record(host, "failures");
        }

        this.failures.push({
            host,
            action: action?.action,
            fingerprint: action?.element?.fingerprint || null,
            error: error?.message || String(error),
            time: new Date().toISOString()
        });

        logger.debug("Learned failure:", action?.action, error?.message);

    }

    all() {

        return this.failures;

    }

}

module.exports = FailureLearner;
