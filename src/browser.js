const { chromium, firefox, webkit } = require("playwright");

const config = require("./config");
const logger = require("./utils/logger");

const ENGINES = { chromium, firefox, webkit };

class Browser {

    constructor(options = {}) {

        this.options = { ...config.browser, ...options };
        this.browser = null;
        this.context = null;
        this.page = null;

    }

    async start() {

        // Idempotent: an injected, already-started browser must not launch a
        // second chromium and leak the first one's process handles.
        if (this.page) {
            return this.page;
        }

        const engine = ENGINES[this.options.engine] || chromium;

        this.browser = await engine.launch({
            headless: this.options.headless,
            slowMo: this.options.slowMo
        });

        this.context = await this.browser.newContext({
            viewport: this.options.viewport,
            storageState: this.options.storageState
        });

        this.context.setDefaultTimeout(this.options.timeout);

        this.context.setDefaultNavigationTimeout(this.options.navigationTimeout);

        this.page = await this.context.newPage();

        logger.info("Browser started.");

        return this.page;

    }

    async open(url) {

        logger.info("Opening:", url);

        // A batch of same-host jobs runs back to back, so a short DNS or
        // connection blip on this box would otherwise fail every remaining
        // job in seconds. Wait for the network to come back instead.
        const delays = [10000, 30000, 60000];

        for (let attempt = 0; ; attempt++) {

            try {
                return await this.page.goto(url, { waitUntil: "domcontentloaded" });
            } catch (error) {

                if (attempt >= delays.length || !/net::ERR_(NAME_NOT_RESOLVED|CONNECTION_|TIMED_OUT|INTERNET_DISCONNECTED|NETWORK_CHANGED|ABORTED)/.test(error.message)) {
                    throw error;
                }

                logger.warn(`Open failed (${error.message.split("\n")[0]}), retrying in ${delays[attempt] / 1000}s`);

                await new Promise(resolve => setTimeout(resolve, delays[attempt]));

            }

        }

    }

    async back() {

        await this.page.goBack({ waitUntil: "domcontentloaded" }).catch(() => null);

    }

    async reload() {

        await this.page.reload({ waitUntil: "domcontentloaded" }).catch(() => null);

    }

    async getPageInfo() {

        return {
            url: this.page.url(),
            title: await this.page.title(),
            text: await this.page.locator("body").innerText()
        };

    }

    async saveSession(file) {

        await this.context.storageState({ path: file });

    }

    async close() {

        if (this.browser) {

            await this.browser.close();

            this.browser = null;
            this.context = null;
            this.page = null;

        }

    }

}

module.exports = Browser;
