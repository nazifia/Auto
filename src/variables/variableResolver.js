const logger = require("../utils/logger");
const VariableManager = require("./variableManager");

// Expands ${NAME} templates and maps action.source -> secret value.
// Values never reach the planner prompt; only names do.
class VariableResolver {

    constructor(manager) {

        this.manager = manager;

        for (const value of Object.values(manager.all())) {

            if (typeof value === "string") {
                logger.addSecret(value);
            }

        }

    }

    // Job files should hold "${PA_PASSWORD}", not the password itself.
    static fromJob(variables = {}) {

        const resolved = {};

        for (const [name, value] of Object.entries(variables)) {

            resolved[name] = typeof value === "string"
                ? value.replace(
                    /\$\{([A-Za-z0-9_.]+)\}/g,
                    (match, key) => process.env[key] ?? match
                )
                : value;

        }

        return new VariableResolver(new VariableManager(resolved));

    }

    names() {

        return Object.keys(this.manager.all());

    }

    all() {

        return this.manager.all();

    }

    // Only what the job declared. There is deliberately no process.env fallback:
    // action.source comes from planner output, which is steered by page content,
    // so a hostile page could otherwise name OPENROUTER_API_KEY as the "source"
    // of a fill and have the agent type it into a form. The job's variables map
    // is the allowlist; ${NAME} against .env is resolved in fromJob, not here.
    get(name) {

        if (!name) {
            return undefined;
        }

        return this.manager.has(name) ? this.manager.get(name) : undefined;

    }

    set(name, value) {

        this.manager.set(name, value);

        if (typeof value === "string") {
            logger.addSecret(value);
        }

    }

    resolveString(text) {

        if (typeof text !== "string") {
            return text;
        }

        return text.replace(/\$\{([A-Za-z0-9_.]+)\}/g, (match, name) => {

            const value = this.get(name);

            return value === undefined ? match : String(value);

        });

    }

    // What the executor should actually type.
    resolveValue(action) {

        if (action.source) {

            const value = this.get(action.source);

            if (value === undefined) {
                throw new Error(`Unknown variable: ${action.source}`);
            }

            return value;

        }

        return this.resolveString(action.value);

    }

    // Deep-resolves ${VAR} inside a job definition.
    resolveObject(input) {

        if (typeof input === "string") {
            return this.resolveString(input);
        }

        if (Array.isArray(input)) {
            return input.map(item => this.resolveObject(item));
        }

        if (input && typeof input === "object") {

            const out = {};

            for (const [key, value] of Object.entries(input)) {
                out[key] = this.resolveObject(value);
            }

            return out;

        }

        return input;

    }

}

module.exports = VariableResolver;
