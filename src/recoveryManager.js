const Retry = require("./recovery/retry");
const Rollback = require("./recovery/rollback");
const Replanner = require("./recovery/replanner");
const DeadEndDetector = require("./recovery/deadEndDetector");
const config = require("./config");
const logger = require("./utils/logger");

// Escalation ladder: retry -> replan -> rollback -> abort.
class RecoveryManager {

    constructor(options = {}) {

        // Old call style: new RecoveryManager(3)
        if (typeof options === "number") {
            options = { maxRetries: options };
        }

        this.retry = options.retry || new Retry(options.maxRetries ?? config.agent.maxRetries);

        this.rollback = options.rollback
            || (options.browser ? new Rollback(options.browser, options.startUrl) : null);

        this.replanner = options.replanner
            || (options.planner ? new Replanner(options.planner) : null);

        this.deadEnd = options.deadEnd || new DeadEndDetector();

    }

    reset() {

        this.retry.reset();

        if (this.rollback) {
            this.rollback.reset();
        }

    }

    canRetry() {

        return this.retry.canRetry();

    }

    // Kept for the old loop shape: count a failure and log it.
    failed(error) {

        const attempt = this.retry.record();

        logger.warn(
            `ACTION FAILED (${attempt}/${this.retry.maxRetries}): ${error.message}`
        );

        return attempt;

    }

    // Decides what to do next. Returns "retry" | "replan" | "rollback" | "abort".
    async handle(error, context = {}) {

        const attempt = this.failed(error);

        // The guard is > rather than >=: at exactly maxRetries the rollback rung
        // below still gets its turn. With >= it never did, because a replanner
        // is always supplied and swallowed every attempt before it.
        if (attempt > this.retry.maxRetries) {
            return "abort";
        }

        // A cached plan that fails is stale by definition — never retry it.
        if (attempt === 1 && context.source !== "cache") {

            await this.retry.backoff();

            return "retry";

        }

        if (attempt < this.retry.maxRetries && this.replanner) {

            this.replanner.invalidate(context.host, context.goal, context.signature);

            return "replan";

        }

        if (this.rollback) {

            await this.rollback.run();

            return "rollback";

        }

        return attempt < this.retry.maxRetries ? "retry" : "abort";

    }

    // Same ladder, but for "nothing is failing, nothing is progressing".
    async handleDeadEnd(context = {}) {

        if (this.replanner) {

            this.replanner.invalidate(context.host, context.goal, context.signature);

        }

        if (this.rollback) {
            return this.rollback.run();
        }

        return "replan";

    }

    stuck(goal, signature) {

        return this.deadEnd.check(goal, signature);

    }

    progressed(goal) {

        this.deadEnd.clear(goal);

    }

    forceFresh() {

        return this.replanner ? this.replanner.consume() : false;

    }

}

module.exports = RecoveryManager;
