// Records everything a successful action teaches us.
class SuccessLearner {

    constructor({ elementMemory, variableLearning, siteMemory }) {

        this.elementMemory = elementMemory;
        this.variableLearning = variableLearning;
        this.siteMemory = siteMemory;

    }

    record(host, action) {

        if (action.element?.fingerprint && this.elementMemory) {
            this.elementMemory.learn(host, action.element.fingerprint);
        }

        if (action.action === "fill" && action.source && this.variableLearning) {
            this.variableLearning.learn(host, action.source, action.element);
        }

    }

    goal(host) {

        if (this.siteMemory) {
            this.siteMemory.record(host, "goals");
        }

    }

}

module.exports = SuccessLearner;
