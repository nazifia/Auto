const Scorer = require("./ranking/scorer");
const ElementMemory = require("./memory/elementMemory");
const ConfidenceModel = require("./knowledge/confidenceModel");
const logger = require("./utils/logger");

class Ranker {

    constructor(elementMemory, confidenceModel) {

        this.memory = elementMemory || new ElementMemory();

        this.scorer = new Scorer(
            this.memory,
            confidenceModel || new ConfidenceModel(this.memory)
        );

    }

    rank(page, context = {}) {

        const ranked = this.scorer.rank(page, context);

        logger.debug("TOP RANKED ELEMENTS");

        logger.table(
            ranked.slice(0, 10).map(element => ({
                score: element.score,
                relevance: element.relevance,
                learned: element.learned,
                role: element.role,
                text: (element.text || "").slice(0, 40),
                fingerprint: element.fingerprint
            }))
        );

        return ranked;

    }

}

module.exports = Ranker;
