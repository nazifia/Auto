const MultiActionPlanner = require("./planning/multiActionPlanner");
const ConfidencePlanner = require("./planning/confidencePlanner");
const PlanValidator = require("./planning/planValidator");
const PlannerCache = require("./memory/plannerCache");
const ConfidenceModel = require("./knowledge/confidenceModel");
const config = require("./config");
const logger = require("./utils/logger");

// Facade: cache first, LLM second. Callers only see `plan(context)`.
class Planner {

    constructor(options = {}) {

        this.cache = options.plannerCache || new PlannerCache();

        this.confidence = options.confidencePlanner
            || new ConfidencePlanner(
                this.cache,
                options.confidenceModel || new ConfidenceModel(options.elementMemory)
            );

        this.llm = options.multiActionPlanner || new MultiActionPlanner(options.ai);

        this.validator = options.planValidator || new PlanValidator();

        this.useCache = options.useCache ?? config.agent.useCache;

        this.stats = { llmCalls: 0, cacheHits: 0 };

    }

    async plan(context) {

        const host = context.page.host;
        const goal = context.goal;

        if (this.useCache && !context.forceFresh) {

            const cached = this.confidence.propose(host, goal, context.page);

            if (cached) {

                try {

                    this.validator.validate(cached.actions);

                    this.stats.cacheHits++;

                    return {
                        actions: cached.actions,
                        signature: cached.signature,
                        source: "cache",
                        confidence: cached.confidence
                    };

                }
                catch (error) {

                    logger.warn("Cached plan failed validation:", error.message);

                    this.cache.forget(host, goal, cached.signature);

                }

            }

        }

        const actions = await this.llm.plan(context);

        this.validator.validate(actions);

        this.stats.llmCalls++;

        const signature = this.confidence.signature(context.page);

        if (this.useCache) {
            this.cache.save(host, goal, signature, actions);
        }

        return { actions, signature, source: "llm", confidence: 0.5 };

    }

    // Called by the agent once it knows whether the plan actually worked.
    record(host, goal, signature, ok) {

        this.confidence.record(host, goal, signature, ok);

    }

    forget(host, goal, signature) {

        this.cache.forget(host, goal, signature);

    }

}

module.exports = Planner;
