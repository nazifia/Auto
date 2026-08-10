const fs = require("fs");
const path = require("path");

const OpenRouter = require("../ai/openrouter");
const logger = require("../utils/logger");
const json = require("../utils/json");

// The LLM leg of planning: goal + ranked page -> up to 5 actions.
class MultiActionPlanner {

    constructor(ai) {

        this.ai = ai || new OpenRouter();

        this.prompt = fs.readFileSync(
            path.join(__dirname, "..", "ai", "plannerPrompt.txt"),
            "utf8"
        );

    }

    // Only these fields go to the model. Locators and values stay local.
    static compact(context) {

        return {

            goal: context.goal,

            done: context.done,

            variables: context.variables,

            knowledge: context.knowledge,

            workflow: context.workflow,

            state: context.state,

            history: context.history,

            failures: context.failures,

            feedback: context.feedback,

            page: {

                url: context.page.url,

                title: context.page.title,

                elements: context.page.elements.map(element => ({
                    elementId: element.elementId,
                    role: element.role,
                    text: element.text,
                    placeholder: element.placeholder,
                    value: element.value ? "<filled>" : "",
                    type: element.type,
                    visible: element.visible,
                    disabled: element.disabled,
                    variable: element.variable
                }))

            }

        };

    }

    async plan(context) {

        const payload = MultiActionPlanner.compact(context);

        logger.debug("PLANNER CONTEXT", JSON.stringify(payload));

        const reply = await this.ai.chat([
            { role: "system", content: this.prompt },
            { role: "user", content: JSON.stringify(payload) }
        ]);

        logger.debug("AI RESPONSE", reply);

        const parsed = json.parse(reply);

        const actions = Array.isArray(parsed)
            ? parsed
            : (parsed.actions || (parsed.action ? [parsed] : []));

        if (!Array.isArray(actions) || actions.length === 0) {
            throw new Error(`Planner returned no actions:\n${reply}`);
        }

        if (parsed.reason) {
            logger.info("Planner:", parsed.reason);
        }

        return MultiActionPlanner.attachElements(actions.slice(0, 5), context.page);

    }

    // elementId is only meaningful for the observation it came from.
    static attachElements(actions, page) {

        return actions.map(action => {

            if (action.elementId === undefined || action.elementId === null) {
                return action;
            }

            const element = page.elements.find(
                candidate => candidate.elementId === Number(action.elementId)
            );

            if (!element) {
                throw new Error(`Planner returned unknown elementId: ${action.elementId}`);
            }

            const { elementId, ...rest } = action;

            return { ...rest, element };

        });

    }

}

module.exports = MultiActionPlanner;
