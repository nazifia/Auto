const { tokens } = require("../utils/similarity");
const { normalize } = require("../utils/fingerprint");

// The planner reporting "finish" is a claim, not a fact. This checks the claim
// against the goal's own `done` hint before the goal is marked complete.
class GoalVerifier {

    constructor(maxRejections = 1) {

        // Bounded: reject a claim at most this many times, then take its word.
        // An unverifiable hint must not stall the job forever.
        this.maxRejections = maxRejections;
        this.rejections = new Map();

    }

    static haystack(page) {

        const fromElements = (page.elements || [])
            .flatMap(element => [element.text, element.placeholder, element.label])
            .filter(Boolean)
            .join(" ");

        // Title counts: "tab shows X" and "page is called X" are normal hints.
        return normalize(
            `${page.title || ""} ${page.text || ""} ${fromElements} ${page.url || ""}`
        );

    }

    check(hint, page) {

        if (!hint) {
            return { ok: true, score: 1, reason: "no completion hint" };
        }

        const words = tokens(hint);

        if (words.length === 0) {
            return { ok: true, score: 1, reason: "hint has no checkable words" };
        }

        const haystack = GoalVerifier.haystack(page);

        const hits = words.filter(word => haystack.includes(word));

        const score = hits.length / words.length;

        return {
            // One meaningful word is enough: the hint is prose, not a selector.
            ok: hits.length > 0,
            score: Number(score.toFixed(2)),
            missing: words.filter(word => !hits.includes(word)),
            reason: hits.length > 0
                ? `matched ${hits.join(", ")}`
                : `none of [${words.join(", ")}] is on the page`
        };

    }

    // Stateful gate around check(): returns whether to accept the claim.
    accept(goal, hint, page) {

        const result = this.check(hint, page);

        if (result.ok) {

            this.rejections.delete(goal);

            return { accepted: true, ...result };

        }

        const count = (this.rejections.get(goal) || 0) + 1;

        this.rejections.set(goal, count);

        if (count > this.maxRejections) {

            return {
                accepted: true,
                forced: true,
                ...result,
                reason: `${result.reason} (accepted anyway after ${count} rejections)`
            };

        }

        return { accepted: false, ...result };

    }

    clear(goal) {

        this.rejections.delete(goal);

    }

}

module.exports = GoalVerifier;
