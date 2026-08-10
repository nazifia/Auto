const fs = require("fs");
const path = require("path");

const OpenRouter = require("./ai/openrouter");
const PlanCache = require("./cache/planCache");
const logger = require("./utils/logger");
const json = require("./utils/json");

// Task ("restart my app") -> ordered goals. Cached by task text, because the
// decomposition does not depend on the live page.
class TaskPlanner {

    constructor(options = {}) {

        this.ai = options.ai || new OpenRouter();
        this.cache = options.cache || new PlanCache();

        this.prompt = fs.readFileSync(
            path.join(__dirname, "ai", "taskPrompt.txt"),
            "utf8"
        );

    }

    static normalize(plan) {

        const goals = Array.isArray(plan) ? plan : plan?.goals;

        if (!Array.isArray(goals) || goals.length === 0) {
            throw new Error(`Task planner returned no goals: ${JSON.stringify(plan)}`);
        }

        return goals
            .map(step => (typeof step === "string" ? { goal: step } : step))
            .filter(step => step && step.goal);

    }

    async createPlan(task) {

        const cached = this.cache.get(task);

        if (cached) {

            logger.info("✓ Execution plan loaded from cache.");

            return TaskPlanner.normalize(cached);

        }

        const reply = await this.ai.chat([
            { role: "system", content: this.prompt },
            { role: "user", content: task }
        ]);

        const plan = TaskPlanner.normalize(json.parse(reply));

        this.cache.save(task, plan);

        return plan;

    }

}

module.exports = TaskPlanner;
