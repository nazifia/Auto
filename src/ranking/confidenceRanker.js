// Memory-driven boost: elements that worked before on this host rank higher,
// elements that failed before rank lower.
class ConfidenceRanker {

    constructor(elementMemory, confidenceModel) {

        this.memory = elementMemory;
        this.model = confidenceModel;

    }

    score(host, element) {

        if (!this.memory || !element.fingerprint) {
            return { learned: 0, confidence: 0.5, boost: 0 };
        }

        const { success, fail } = this.memory.stats(host, element.fingerprint);

        const confidence = this.model
            ? this.model.element(host, element.fingerprint)
            : 0.5;

        // Diminishing returns: 10 successes should not outweigh goal relevance.
        const boost = (Math.log1p(success) * 25) - (fail * 15);

        return { learned: success, confidence, boost };

    }

}

module.exports = ConfidenceRanker;
