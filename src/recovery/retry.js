const { sleep } = require("../utils/timer");

class Retry {

    constructor(maxRetries = 3) {

        this.maxRetries = maxRetries;
        this.attempts = 0;

    }

    reset() {

        this.attempts = 0;

    }

    record() {

        this.attempts++;

        return this.attempts;

    }

    canRetry() {

        return this.attempts < this.maxRetries;

    }

    // Linear, not exponential: a stuck page rarely unsticks after 8 seconds.
    async backoff() {

        await sleep(Math.min(this.attempts * 1000, 5000));

    }

}

module.exports = Retry;
