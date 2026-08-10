const ALLOWED = new Set([
    "goto", "click", "fill", "press", "select", "check",
    "hover", "scroll", "wait", "finish",
    // vision: target a pixel or the focused element instead of a DOM node
    "clickAt", "type"
]);

const NO_ELEMENT = new Set([
    "goto", "wait", "finish", "scroll", "clickAt", "type", "press"
]);

// Structural validation of what the planner returned, before anything touches
// the browser. Rejecting here is much cheaper than a Playwright timeout.
class PlanValidator {

    constructor(allowed = ALLOWED) {

        this.allowed = allowed;

    }

    validate(actions) {

        if (!Array.isArray(actions)) {
            throw new Error("Planner did not return an array of actions.");
        }

        if (actions.length === 0) {
            throw new Error("Planner returned an empty plan.");
        }

        actions.forEach((action, index) => this.validateAction(action, index));

        return true;

    }

    validateAction(action, index) {

        const at = `action[${index}]`;

        if (!action || typeof action !== "object") {
            throw new Error(`${at} is not an object.`);
        }

        if (!action.action) {
            throw new Error(`${at} is missing 'action'.`);
        }

        if (!this.allowed.has(action.action)) {
            throw new Error(`${at} has unknown action: ${action.action}`);
        }

        if (action.action === "goto") {

            if (!action.url) {
                throw new Error(`${at} goto is missing 'url'.`);
            }

            // The planner is steered by page content, so its url is untrusted.
            // file:// would let a hostile page read .env into page text, and
            // that text goes straight back into the next prompt.
            if (!/^https?:\/\//i.test(String(action.url))) {
                throw new Error(`${at} goto must be http(s): ${action.url}`);
            }

        }

        if (action.action === "fill" && !action.source && action.value === undefined) {
            throw new Error(`${at} fill needs 'source' or 'value'.`);
        }

        if (action.action === "type" && !action.source && action.value === undefined) {
            throw new Error(`${at} type needs 'source' or 'value'.`);
        }

        if (
            action.action === "clickAt"
            && (!Number.isFinite(Number(action.x)) || !Number.isFinite(Number(action.y)))
        ) {
            throw new Error(`${at} clickAt needs numeric 'x' and 'y'.`);
        }

        if (action.action === "select" && action.value === undefined) {
            throw new Error(`${at} select is missing 'value'.`);
        }

        if (!NO_ELEMENT.has(action.action) && !action.element) {
            throw new Error(`${at} ${action.action} has no resolved element.`);
        }

        return true;

    }

    // A batched action can go stale between steps: re-check before running it.
    stillValid(action, page) {

        if (!action.element) {
            return true;
        }

        return (page.elements || []).some(
            element => element.fingerprint === action.element.fingerprint
        );

    }

}

module.exports = PlanValidator;
module.exports.ALLOWED = ALLOWED;
