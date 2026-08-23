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

        await this.page.goto(url, { waitUntil: "domcontentloaded" });

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
