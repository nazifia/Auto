const { normalize } = require("./fingerprint");

const STOP = new Set([
    "the", "a", "an", "then", "and", "to", "of", "on", "in", "for",
    "click", "press", "open", "go", "goto", "my", "please"
]);

function tokens(text) {

    return normalize(text)
        .split(/[^a-z0-9]+/)
        .filter(word => word.length > 1 && !STOP.has(word));

}

function jaccard(a, b) {

    const left = new Set(tokens(a));
    const right = new Set(tokens(b));

    if (left.size === 0 || right.size === 0) {
        return 0;
    }

    let shared = 0;

    for (const word of left) {

        if (right.has(word)) {
            shared++;
        }

    }

    return shared / (left.size + right.size - shared);

}

// 0..1 relevance of `text` to `goal`. Exact containment beats token overlap.
function score(goal, text) {

    const a = normalize(goal);
    const b = normalize(text);

    if (!a || !b) {
        return 0;
    }

    if (a === b) {
        return 1;
    }

    if (a.includes(b) || b.includes(a)) {

        const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);

        return 0.6 + (0.4 * ratio);

    }

    return jaccard(a, b);

}

module.exports = { tokens, jaccard, score };
