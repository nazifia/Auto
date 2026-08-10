const config = require("../config");
const { sleep } = require("../utils/timer");

// Waits for the page to stop moving after an action, without ever throwing:
// a page that never reaches network idle is normal, not an error.
class PageWatcher {

    constructor(browser, settleMs = config.agent.settleMs) {

        this.browser = browser;
        this.settleMs = settleMs;

    }

    async settle(timeout = 3000) {

        const page = this.browser.page;

        await page.waitForLoadState("domcontentloaded", { timeout }).catch(() => null);

        await page.waitForLoadState("networkidle", { timeout }).catch(() => null);

        await sleep(this.settleMs);

    }

}

module.exports = PageWatcher;
