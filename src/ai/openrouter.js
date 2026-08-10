const config = require("../config");
const logger = require("../utils/logger");
const { sleep } = require("../utils/timer");

class OpenRouter {

    constructor(options = {}) {

        this.apiKey = options.apiKey || config.ai.apiKey;
        this.model = options.model || config.ai.model;
        this.url = options.url || config.ai.url;
        this.temperature = options.temperature ?? config.ai.temperature;
        this.maxRetries = options.maxRetries ?? config.ai.maxRetries;
        this.timeout = options.timeout ?? config.ai.timeout;

        // Cheap usage accounting so statistics can report LLM cost drivers.
        this.calls = 0;
        this.tokens = 0;

        if (!this.apiKey) {
            throw new Error(
                "OPENROUTER_API_KEY is missing. Add it to .env"
            );
        }

        logger.addSecret(this.apiKey);

    }

    async chat(messages, options = {}) {

        const body = {
            model: options.model || this.model,
            temperature: options.temperature ?? this.temperature,
            messages
        };

        if (options.json !== false) {
            body.response_format = { type: "json_object" };
        }

        let lastError;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {

            try {
                return await this.send(body);
            }
            catch (error) {

                // AbortSignal.timeout throws a bare TimeoutError; say what died.
                lastError = error.name === "TimeoutError"
                    ? new Error(`AI request timed out after ${this.timeout}ms`)
                    : error;

                // Some models reject response_format — drop it and retry once.
                if (body.response_format && /response_format|json_object/i.test(error.message)) {

                    delete body.response_format;
                    continue;

                }

                // A bad key or a malformed request fails the same way every
                // time. Retrying it just burns three timeouts before saying so.
                if (!OpenRouter.retryable(error)) {
                    break;
                }

                if (attempt === this.maxRetries) {
                    break;
                }

                logger.warn(`AI call failed (${attempt}/${this.maxRetries}): ${lastError.message}`);

                // A 429 usually says how long to wait; guessing shorter than it
                // does only earns another 429.
                await sleep(Math.max(error.retryAfter || 0, attempt * 1000));

            }

        }

        throw lastError;

    }

    // Network trouble and server-side trouble are worth another go; a 4xx that
    // is not "slow down" or "timed out" is a verdict, not a hiccup.
    static retryable(error) {

        if (!error.status) {
            return true;
        }

        return error.status >= 500 || error.status === 408 || error.status === 429;

    }

    async send(body) {

        // Without this, a stalled connection hangs the whole job forever — and
        // under the server it holds a queue slot with it.
        const response = await fetch(this.url, {
            signal: AbortSignal.timeout(this.timeout),
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        const text = await response.text();

        if (!response.ok) {

            const error = new Error(`AI ${response.status}: ${text}`);

            error.status = response.status;

            const retryAfter = Number(response.headers.get("retry-after"));

            if (Number.isFinite(retryAfter) && retryAfter > 0) {
                error.retryAfter = retryAfter * 1000;
            }

            throw error;

        }

        const payload = JSON.parse(text);

        const content = payload?.choices?.[0]?.message?.content;

        if (typeof content !== "string") {
            throw new Error(`AI returned no content: ${text}`);
        }

        this.calls++;
        this.tokens += payload?.usage?.total_tokens || 0;

        return content;

    }

}

module.exports = OpenRouter;
