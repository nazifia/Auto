const axios = require("axios");

const logger = require("../utils/logger");

// Non-browser capability: call an HTTP endpoint as part of a job. This is the
// seam the Phase 5 agents (email, sheets, files) plug into.
class ApiPlugin {

    constructor(options = {}) {

        this.name = "api";
        this.timeout = options.timeout || 15000;
        this.headers = options.headers || {};

    }

    async run({ method = "GET", url, data, headers, params }) {

        if (!url) {
            throw new Error("api plugin requires a url.");
        }

        logger.info(`→ api ${method.toUpperCase()} ${url}`);

        const response = await axios({
            method,
            url,
            data,
            params,
            timeout: this.timeout,
            headers: { ...this.headers, ...headers },
            validateStatus: () => true
        });

        if (response.status >= 400) {
            throw new Error(`api ${response.status}: ${JSON.stringify(response.data)}`);
        }

        return response.data;

    }

}

module.exports = ApiPlugin;
