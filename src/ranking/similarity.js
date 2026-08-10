const { score } = require("../utils/similarity");

// How well an element's own labels match the current goal.
class GoalSimilarity {

    score(goal, element) {

        if (!goal) {
            return 0;
        }

        const candidates = [
            element.text,
            element.placeholder,
            element.label,
            element.name,
            element.id,
            element.href
        ].filter(Boolean);

        let best = 0;

        for (const candidate of candidates) {
            best = Math.max(best, score(goal, candidate));
        }

        return best;

    }

}

module.exports = GoalSimilarity;
