const config = require("./config");

// Tracks sub-goals plus how hard each one is fighting back.
class GoalManager {

    constructor(plan, maxAttempts = config.agent.maxGoalAttempts) {

        this.plan = (Array.isArray(plan) ? plan : plan?.goals || [])
            .map(step => (typeof step === "string" ? { goal: step } : step))
            .filter(step => step && (step.goal || step.plugin))
            .map(step => (step.goal ? step : { ...step, goal: `run ${step.plugin}` }));

        if (this.plan.length === 0) {
            throw new Error("Execution plan has no goals.");
        }

        this.index = 0;
        this.maxAttempts = maxAttempts;
        this.attempts = 0;
        this.results = [];

    }

    step() {

        return this.finished() ? null : this.plan[this.index];

    }

    current() {

        return this.step()?.goal || null;

    }

    done() {

        return this.step()?.done || null;

    }

    attempt() {

        this.attempts++;

        return this.attempts;

    }

    exhausted() {

        return this.attempts >= this.maxAttempts;

    }

    complete(note) {

        this.results.push({
            goal: this.current(),
            ok: true,
            note: note || null,
            attempts: this.attempts
        });

        this.index++;
        this.attempts = 0;

    }

    abandon(reason) {

        this.results.push({
            goal: this.current(),
            ok: false,
            note: reason || null,
            attempts: this.attempts
        });

        this.index++;
        this.attempts = 0;

    }

    finished() {

        return this.index >= this.plan.length;

    }

    succeeded() {

        return this.results.length > 0 && this.results.every(result => result.ok);

    }

    progress() {

        return `${Math.min(this.index + 1, this.plan.length)}/${this.plan.length}`;

    }

    all() {

        return this.plan;

    }

    summary() {

        return this.results;

    }

}

module.exports = GoalManager;
