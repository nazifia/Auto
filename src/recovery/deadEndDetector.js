const logger = require("../utils/logger");

// The agent is stuck when the same goal keeps seeing the same page signature.
// Cheaper and more reliable than trying to prove progress semantically.
class DeadEndDetector {

    constructor(limit = 3) {

        this.limit = limit;
        this.seen = new Map();

    }

    key(goal, signature) {

        return `${goal}::${signature}`;

    }

    check(goal, signature) {

        const key = this.key(goal, signature);

        const count = (this.seen.get(key) || 0) + 1;

        this.seen.set(key, count);

        if (count >= this.limit) {

            logger.warn(`Dead end: goal "${goal}" saw the same page ${count} times.`);

            return true;

        }

        return false;

    }

    clear(goal) {

        for (const key of this.seen.keys()) {

            if (key.startsWith(`${goal}::`)) {
                this.seen.delete(key);
            }

        }

    }

    reset() {

        this.seen.clear();

    }

}

module.exports = DeadEndDetector;
