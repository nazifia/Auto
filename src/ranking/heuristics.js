// Structural scoring: what the element is, regardless of the goal.
const ROLE_SCORE = {
    input: 25,
    button: 20,
    tab: 18,
    link: 12,
    select: 18,
    textarea: 15
};

class Heuristics {

    score(element) {

        let score = ROLE_SCORE[element.role] || 5;

        if (element.visible) {
            score += 15;
        }
        else {
            score -= 30;
        }

        if (element.clickable) {
            score += 10;
        }

        if (element.disabled) {
            score -= 40;
        }

        if (element.required) {
            score += 5;
        }

        // An empty input is far more likely to be the next target than a full one.
        if (element.role === "input" && !element.value) {
            score += 8;
        }

        if (element.type === "hidden") {
            score -= 60;
        }

        // Junk links pollute the top of the list otherwise.
        const text = (element.text || "").trim();

        if (!text && !element.placeholder && !element.name && !element.id) {
            score -= 15;
        }

        if (text.length > 120) {
            score -= 10;
        }

        return score;

    }

}

module.exports = Heuristics;
