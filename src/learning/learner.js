const SuccessLearner = require("./successLearner");
const FailureLearner = require("./failureLearner");
const WorkflowLearner = require("./workflowLearner");
const Statistics = require("./statistics");

// One entry point for the whole learning system, so the agent loop has exactly
// four calls to make: success, failure, goal, job.
class Learner {

    constructor(deps = {}) {

        this.success = new SuccessLearner(deps);
        this.failure = new FailureLearner(deps);
        this.workflow = new WorkflowLearner(deps.workflowMemory);
        this.statistics = deps.statistics || new Statistics();
        this.siteMemory = deps.siteMemory;
        this.brain = deps.brain;

    }

    actionSucceeded(host, action) {

        this.success.record(host, action);

        this.statistics.add("actions");

    }

    actionFailed(host, action, error) {

        this.failure.record(host, action, error);

        this.statistics.add("failures");

    }

    goalCompleted(host) {

        this.success.goal(host);

        this.statistics.add("goals");

    }

    planned(host, source) {

        const field = source === "cache" ? "cacheHits" : "llmCalls";

        this.statistics.add(field);

        if (this.siteMemory) {
            this.siteMemory.record(host, field);
        }

    }

    jobFinished({ host, task, actions, page, ok }) {

        if (ok) {
            this.workflow.success(host, task, actions);
        }
        else {
            this.workflow.failure(host, task);
        }

        if (this.brain && page) {
            this.brain.learn(page, actions);
        }

        return this.statistics.report({ host, task, ok });

    }

}

module.exports = Learner;
