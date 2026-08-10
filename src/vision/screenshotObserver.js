const config = require("../config");
const Screenshot = require("../browser/screenshot");
const logger = require("../utils/logger");

// The visual counterpart of observer.js: instead of a DOM element list it
// returns a picture of the page plus the geometry needed to click inside it.
class ScreenshotObserver {

    constructor(browser, options = {}) {

        this.browser = browser;
        this.screenshot = options.screenshot || new Screenshot(browser);
        this.fullPage = options.fullPage ?? config.vision.fullPage;

    }

    async observe(options = {}) {

        const page = this.browser.page;

        const fullPage = options.fullPage ?? this.fullPage;

        const buffer = await page.screenshot({ fullPage });

        // Viewport coordinates only map 1:1 when the shot is not full-page.
        const viewport = page.viewportSize() || { width: 0, height: 0 };

        const shot = {
            buffer,
            dataUrl: ScreenshotObserver.dataUrl(buffer),
            fullPage,
            width: viewport.width,
            height: viewport.height,
            scroll: await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY })).catch(() => ({ x: 0, y: 0 })),
            url: page.url(),
            bytes: buffer.length
        };

        logger.debug(`Screenshot captured (${shot.bytes} bytes, ${shot.width}x${shot.height}).`);

        return shot;

    }

    static dataUrl(buffer) {

        return `data:image/png;base64,${buffer.toString("base64")}`;

    }

    async save(label) {

        return this.screenshot.take(label);

    }

}

module.exports = ScreenshotObserver;
