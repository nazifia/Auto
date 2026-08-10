const ActionExecutor = require("./browser/actionExecutor");
const LocatorResolver = require("./browser/locatorResolver");
const PageWatcher = require("./browser/pageWatcher");
const LocatorCache = require("./cache/locatorCache");

// Facade over the browser/ layer: resolve the element, run the action, settle.
class Executor {

    constructor(browser, variables, options = {}) {

        this.browser = browser;

        this.locatorCache = options.locatorCache || new LocatorCache();

        this.resolver = options.resolver
            || new LocatorResolver(browser, this.locatorCache);

        this.watcher = options.watcher || new PageWatcher(browser);

        this.actions = new ActionExecutor(
            browser,
            this.resolver,
            variables,
            this.watcher
        );

    }

    async execute(action) {

        await this.actions.run(action);

    }

    async settle() {

        await this.watcher.settle();

    }

}

module.exports = Executor;
