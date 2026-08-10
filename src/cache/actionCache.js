const { elementKey } = require("../utils/fingerprint");

// In-memory record of what the agent did on which page signature this run.
// Used to detect loops (same action, same page, no progress).
class ActionCache {

    constructor(limit = 200) {

        this.entries = [];
        this.limit = limit;

    }

    static key(action, signature) {

        return [
            signature,
            action.action,
            elementKey(action.element),
            action.source || action.value || action.url || ""
        ].join("::");

    }

    record(action, signature) {

        const key = ActionCache.key(action, signature);

        this.entries.push({ key, time: Date.now() });

        if (this.entries.length > this.limit) {
            this.entries.shift();
        }

        return key;

    }

    count(action, signature) {

        const key = ActionCache.key(action, signature);

        return this.entries.filter(entry => entry.key === key).length;

    }

    repeated(action, signature, threshold = 2) {

        return this.count(action, signature) >= threshold;

    }

    clear() {

        this.entries = [];

    }

}

module.exports = ActionCache;
