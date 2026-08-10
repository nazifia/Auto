const { normalize } = require("../utils/fingerprint");

// Evaluates the optional `when` guard on an action against the live page.
// Lets one cached plan cover "already logged in" and "not logged in".
class ConditionalPlanner {

    shouldRun(action, page) {

        const condition = action.when;

        if (!condition) {
            return true;
        }

        if (condition.exists !== undefined) {
            return this.present(page, condition.exists);
        }

        if (condition.missing !== undefined) {
            return !this.present(page, condition.missing);
        }

        if (condition.url !== undefined) {
            return String(page.url || "").includes(condition.url);
        }

        if (condition.state !== undefined && page.state) {
            return Boolean(page.state[condition.state]);
        }

        // Unknown condition shape: run rather than silently stall.
        return true;

    }

    present(page, needle) {

        const target = normalize(needle);

        if (!target) {
            return false;
        }

        const inElements = (page.elements || []).some(element =>
            normalize(element.text).includes(target)
            || normalize(element.placeholder).includes(target)
        );

        return inElements || normalize(page.text).includes(target);

    }

}

module.exports = ConditionalPlanner;
