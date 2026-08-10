// A plan as an ordered, inspectable set of steps. Sequential today; the shape
// is what lets recovery report "failed at step 3 of 5" instead of "failed".
class ExecutionGraph {

    constructor(actions = []) {

        this.steps = actions.map((action, index) => ({
            index,
            action,
            status: "pending",
            error: null
        }));

    }

    [Symbol.iterator]() {

        return this.steps[Symbol.iterator]();

    }

    get length() {

        return this.steps.length;

    }

    done(step) {

        step.status = "done";

    }

    skip(step, reason) {

        step.status = "skipped";
        step.error = reason || null;

    }

    fail(step, error) {

        step.status = "failed";
        step.error = error?.message || String(error);

    }

    completed() {

        return this.steps.filter(step => step.status === "done");

    }

    failed() {

        return this.steps.find(step => step.status === "failed") || null;

    }

    remaining() {

        return this.steps.filter(step => step.status === "pending");

    }

    summary() {

        return this.steps.map(step => `${step.index}:${step.action.action}=${step.status}`).join(" ");

    }

}

module.exports = ExecutionGraph;
