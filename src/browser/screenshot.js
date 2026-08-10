const fs = require("fs");
const path = require("path");

const config = require("../config");
const logger = require("../utils/logger");

class Screenshot {

    constructor(browser, folder = config.paths.screenshots) {

        this.browser = browser;
        this.folder = folder;

    }

    async take(label = "page") {

        try {

            fs.mkdirSync(this.folder, { recursive: true });

            const name = `${Date.now()}-${label.replace(/[^a-z0-9]+/gi, "-")}.png`;

            const file = path.join(this.folder, name);

            await this.browser.page.screenshot({ path: file, fullPage: false });

            logger.debug("Screenshot:", file);

            return file;

        }
        catch (error) {

            logger.warn("Screenshot failed:", error.message);

            return null;

        }

    }

}

module.exports = Screenshot;
