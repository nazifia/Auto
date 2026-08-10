const LocatorBuilder = require("./locatorBuilder");
const logger = require("../utils/logger");
const { elementKey } = require("../utils/fingerprint");

// Turns an element description into a live Playwright locator, preferring the
// strategy that worked last time on this host (self-healing locators).
class LocatorResolver {

    constructor(browser, locatorCache) {

        this.browser = browser;
        this.cache = locatorCache;
        this.builder = new LocatorBuilder();

    }

    fromStrategy(strategy) {

        const page = this.browser.page;

        switch (strategy.type) {

            case "id":
                // Attribute form, so ids containing CSS metacharacters still work.
                return page.locator(`[id="${strategy.value}"]`);

            case "name":
                return page.locator(`[name="${strategy.value}"]`);

            case "placeholder":
                return page.getByPlaceholder(strategy.value, { exact: false });

            case "label":
                return page.getByLabel(strategy.value, { exact: false });

            case "role":
                return page.getByRole(strategy.role || "button", {
                    name: strategy.value,
                    exact: false
                });

            case "text":
                return page.getByText(strategy.value, { exact: false });

            case "css":
                return page.locator(strategy.value);

            case "xpath":
                return page.locator(`xpath=${strategy.value}`);

            default:
                return null;

        }

    }

    async tryStrategy(strategy) {

        try {

            const locator = this.fromStrategy(strategy);

            if (!locator) {
                return null;
            }

            const count = await locator.count();

            if (count === 0) {
                return null;
            }

            // A unique match is trustworthy; otherwise take the first visible one.
            const candidate = count === 1 ? locator : locator.first();

            if (!(await candidate.isVisible().catch(() => false))) {
                return null;
            }

            return { locator: candidate, strategy, unique: count === 1 };

        }
        catch {
            return null;
        }

    }

    async resolve(element, host) {

        if (!element) {
            throw new Error("Cannot resolve a missing element.");
        }

        const key = elementKey(element);

        const strategies = this.builder.build(element);

        const cached = this.cache && this.cache.get(host, key);

        // Cached winner first, then everything else.
        const ordered = cached
            ? [cached, ...strategies.filter(s => JSON.stringify(s) !== JSON.stringify(cached))]
            : strategies;

        let fallback = null;

        for (const strategy of ordered) {

            const found = await this.tryStrategy(strategy);

            if (!found) {
                continue;
            }

            if (!found.unique && !fallback) {
                fallback = found;
                continue;
            }

            logger.debug(`✓ locator ${strategy.type} (${strategy.value})`);

            if (this.cache) {
                this.cache.save(host, key, strategy);
            }

            return found.locator;

        }

        if (fallback) {

            logger.debug(`✓ locator ${fallback.strategy.type} (ambiguous, using first)`);

            if (this.cache) {
                this.cache.save(host, key, fallback.strategy);
            }

            return fallback.locator;

        }

        if (this.cache) {
            this.cache.forget(host, key);
        }

        throw new Error(`Unable to locate element: ${key}`);

    }

}

module.exports = LocatorResolver;
