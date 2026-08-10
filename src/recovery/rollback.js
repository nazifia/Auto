const logger = require("../utils/logger");

// Cheapest way back to a known page state: reload, then go back, then re-open
// the job's entry URL.
class Rollback {

    constructor(browser, startUrl) {

        this.browser = browser;
        this.startUrl = startUrl;
        this.level = 0;

    }

    reset() {

        this.level = 0;

    }

    async run() {

        this.level++;

        if (this.level === 1) {

            logger.warn("Rollback: reloading page.");

            await this.browser.reload();

            return "reload";

        }

        if (this.level === 2) {

            logger.warn("Rollback: going back.");

            await this.browser.back();

            return "back";

        }

        logger.warn("Rollback: returning to start URL.");

        await this.browser.open(this.startUrl);

        return "restart";

    }

}

module.exports = Rollback;
