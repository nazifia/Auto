// Turns success/failure counts into a 0..1 confidence using Laplace smoothing,
// so one lucky success does not immediately outrank a proven path.
class ConfidenceModel {

    constructor(elementMemory) {

        this.elementMemory = elementMemory;

    }

    static ratio(success = 0, fail = 0) {

        return (success + 1) / (success + fail + 2);

    }

    // Confidence that this element is still the right target on this host.
    element(host, fingerprint) {

        if (!this.elementMemory || !fingerprint) {
            return 0.5;
        }

        const { success, fail } = this.elementMemory.stats(host, fingerprint);

        if (success === 0 && fail === 0) {
            return 0.5;
        }

        return ConfidenceModel.ratio(success, fail);

    }

    // Confidence for a whole cached plan: the weakest element caps it.
    plan(host, actions, cacheConfidence = 0.5) {

        const targets = actions
            .map(action => action.element?.fingerprint)
            .filter(Boolean);

        if (targets.length === 0) {
            return cacheConfidence;
        }

        const weakest = Math.min(
            ...targets.map(fingerprint => this.element(host, fingerprint))
        );

        return Math.min(weakest, cacheConfidence);

    }

}

module.exports = ConfidenceModel;
