const SiteKnowledge = require("./knowledge/siteKnowledge");
const KnowledgeFilter = require("./knowledge/filter");
const logger = require("./utils/logger");

// Assembles everything the planner is allowed to see. Nothing else builds
// planner input, so token cost has exactly one place to be tuned.
class Brain {

    constructor(options = {}) {

        this.knowledge = options.siteKnowledge || new SiteKnowledge();
        this.filter = options.filter || new KnowledgeFilter();
        this.variableLearning = options.variableLearning || null;
        this.workflowMemory = options.workflowMemory || null;

    }

    buildContext({ goal, done, page, state, history, variables, feedback, task }) {

        return {

            goal,

            done,

            state,

            history,

            // What went wrong recently, so the planner stops repeating it.
            failures: (history || []).filter(entry => entry.ok === false),

            // Why the last attempt was rejected, if it was.
            feedback: feedback || null,

            knowledge: this.knowledge.get(page.url),

            // A proven path for this exact task on this host, if we have one.
            workflow: this.workflow(page.host, task),

            // Names only — values never leave the executor.
            variables,

            page: {

                url: page.url,

                host: page.host,

                title: page.title,

                text: page.text,

                elements: this.annotate(page.host, page.elements)

            }

        };

    }

    // Tells the planner which variable already belongs in which field, so it
    // does not have to re-guess the password box on every run.
    annotate(host, elements = []) {

        if (!this.variableLearning) {
            return elements;
        }

        return elements.map(element => {

            const variable = this.variableLearning.suggest(host, element);

            return variable ? { ...element, variable } : element;

        });

    }

    workflow(host, task) {

        if (!this.workflowMemory || !task) {
            return null;
        }

        const entry = this.workflowMemory.get(host, task);

        if (!entry) {
            return null;
        }

        return {
            confidence: Number(this.workflowMemory.confidence(host, task).toFixed(2)),
            runs: entry.runs,
            steps: entry.steps.map(step => ({
                action: step.action,
                target: step.fingerprint,
                source: step.source,
                goal: step.goal
            }))
        };

    }

    // Called once a goal or job completes: distil the run into site knowledge.
    learn(page, history) {

        const knowledge = this.knowledge.get(page.url) || {};

        for (const action of history) {

            if (!action.element || action.ok === false || !this.filter.isUseful(action)) {
                continue;
            }

            if (action.action === "fill" && action.source) {

                knowledge[action.source] = {
                    placeholder: action.element.placeholder,
                    role: action.element.role,
                    fingerprint: action.element.fingerprint
                };

            }

            if (action.action === "click" && action.element.text) {

                knowledge[action.element.text] = {
                    role: action.element.role,
                    fingerprint: action.element.fingerprint
                };

            }

        }

        if (Object.keys(knowledge).length === 0) {
            return;
        }

        this.knowledge.save(page.url, knowledge);

        logger.debug("Site knowledge updated for", page.host);

    }

}

module.exports = Brain;
