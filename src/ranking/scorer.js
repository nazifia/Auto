const Heuristics = require("./heuristics");
const GoalSimilarity = require("./similarity");
const ConfidenceRanker = require("./confidenceRanker");
const config = require("../config");

// Combines the three signals into one ordered shortlist. The shortlist is what
// the planner actually sees, so this is the main token lever.
class Scorer {

    constructor(elementMemory, confidenceModel) {

        this.heuristics = new Heuristics();
        this.similarity = new GoalSimilarity();
        this.confidence = new ConfidenceRanker(elementMemory, confidenceModel);

    }

    rank(page, context = {}) {

        const goal = context.goal || "";
        const host = page.host;
        const topN = context.topN || config.ranking.topN;

        const ranked = (page.elements || []).map(element => {

            const relevance = this.similarity.score(goal, element);

            const learned = this.confidence.score(host, element);

            const score = this.heuristics.score(element)
                + (relevance * 60)
                + learned.boost;

            return {
                ...element,
                relevance: Number(relevance.toFixed(3)),
                learned: learned.learned,
                confidence: Number(learned.confidence.toFixed(3)),
                score: Math.round(score)
            };

        });

        ranked.sort((a, b) => b.score - a.score);

        return ranked.slice(0, topN);

    }

}

module.exports = Scorer;
