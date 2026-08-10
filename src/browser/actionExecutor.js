const logger = require("../utils/logger");

// Performs one validated action. Knows nothing about planning or recovery.
class ActionExecutor {

    constructor(browser, resolver, variables, watcher) {

        this.browser = browser;
        this.resolver = resolver;
        this.variables = variables;
        this.watcher = watcher;

    }

    host() {

        try {
            return new URL(this.browser.page.url()).hostname;
        }
        catch {
            return "";
        }

    }

    async locator(action) {

        return this.resolver.resolve(action.element, this.host());

    }

    async run(action) {

        const page = this.browser.page;

        switch (action.action) {

            case "goto": {

                if (!action.url) {
                    throw new Error("goto requires a url.");
                }

                logger.info("→ goto", action.url);

                await page.goto(action.url, { waitUntil: "domcontentloaded" });

                return;

            }

            case "fill": {

                const value = this.variables.resolveValue(action);

                if (value === undefined || value === null) {
                    throw new Error(
                        `fill has no value (source: ${action.source})`
                    );
                }

                logger.info(
                    "→ fill",
                    action.source ? `${action.source} into` : "",
                    action.element?.placeholder || action.element?.name || action.element?.id || ""
                );

                const locator = await this.locator(action);

                await locator.fill(String(value));

                return;

            }

            case "click": {

                logger.info("→ click", action.element?.text || action.element?.fingerprint);

                const locator = await this.locator(action);

                // No waitForNavigation: most clicks do not navigate, and paying
                // that timeout on every one of them dominates the run time.
                // settle() after the action covers both cases.
                await locator.click();

                return;

            }

            // Vision path: no DOM node, just a pixel and the keyboard.
            case "clickAt": {

                logger.info("→ clickAt", `${action.x},${action.y}`, action.value || "");

                await page.mouse.click(Number(action.x), Number(action.y));

                return;

            }

            case "type": {

                const text = this.variables.resolveValue(action);

                if (text === undefined || text === null) {
                    throw new Error(`type has no value (source: ${action.source})`);
                }

                logger.info("→ type", action.source ? action.source : "literal text");

                await page.keyboard.type(String(text), { delay: 20 });

                return;

            }

            case "press": {

                const key = action.key || action.value || "Enter";

                logger.info("→ press", key);

                if (action.element) {

                    const locator = await this.locator(action);

                    await locator.press(key);

                }
                else {
                    await page.keyboard.press(key);
                }

                return;

            }

            case "select": {

                logger.info("→ select", action.value);

                const locator = await this.locator(action);

                await locator.selectOption(String(action.value));

                return;

            }

            case "check": {

                const locator = await this.locator(action);

                await locator.setChecked(action.value !== false);

                return;

            }

            case "hover": {

                const locator = await this.locator(action);

                await locator.hover();

                return;

            }

            case "scroll": {

                const direction = String(action.value || "down").toLowerCase();

                const amount = direction === "up" ? -600 : 600;

                logger.info("→ scroll", direction);

                await page.mouse.wheel(0, amount);

                return;

            }

            case "wait": {

                const ms = Number(action.ms) || 2000;

                logger.info("→ wait", `${ms}ms`);

                await page.waitForTimeout(ms);

                return;

            }

            case "finish": {

                logger.info("✓", action.value || "Goal complete.");

                return;

            }

            default:
                throw new Error(`Unknown action: ${action.action}`);

        }

    }

}

module.exports = ActionExecutor;
