const ApiPlugin = require("./api");
const logger = require("../utils/logger");

// Non-browser capabilities a plan step can call. Phase 5 agents (email, files,
// sheets) register here; the agent loop does not need to know about any of them.
const registry = {
    api: () => new ApiPlugin()
};

const instances = {};

function get(name) {

    if (!registry[name]) {

        throw new Error(
            `Unknown plugin: ${name}. Available: ${Object.keys(registry).join(", ")}`
        );

    }

    instances[name] = instances[name] || registry[name]();

    return instances[name];

}

async function run(name, payload = {}) {

    logger.info(`→ plugin ${name}`);

    return get(name).run(payload);

}

module.exports = { registry, get, run };
