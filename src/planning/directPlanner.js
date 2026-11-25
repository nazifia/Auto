const { normalize } = require("../utils/fingerprint");

// Prose that names the widget rather than the control ("Click the button").
// Matching one of these would be a guess, which is exactly what this class
// exists not to do.
const GENERIC = new Set(["button", "link", "tab", "submit", "it", "this", "that"]);

// Recognises a goal that names exactly one visible control -- "Click the Run
// until 3 months from today button" -- and turns it into that click plus a
// finish. The job/sheet already said what to press, so there is nothing for an
// LLM to guess here; routing it through the model is what let a retired model
// 404 turn a plainly clickable button into a silent no-op.
class DirectPlanner {

    // The control name inside the goal, or null when the goal is not an
    // explicit single click.
    static label(goal) {

        // "Click X now - always click it, ..." carries a clarification for the
        // model after "now". It is not part of the control's name.
        const head = String(goal || "").trim().split(/\s+now\b/i)[0].trim();

        const match = /^(?:click|tap)\s+(?:the\s+)?(.*?)(?:\s+button)?$/i.exec(head);

        if (!match) {
            return null;
        }

        const label = match[1]
            .replace(/^["']|["']$/g, "")
            .trim();

        if (GENERIC.has(normalize(label))) {
            return null;
        }

        // One or two characters is almost always a coincidence ("Click +"),
        // not a name worth trusting without the planner.
        return label.length >= 3 ? label : null;

    }

    plan(goal, page) {

        const label = DirectPlanner.label(goal);

        if (!label) {
            return null;
        }

        const target = normalize(label);

        const matches = (page.elements || []).filter(element => {

            if (element.disabled) {
                return false;
            }

            if (!["button", "link", "tab"].includes(element.role)) {
                return false;
            }

            return normalize(element.text) === target;

        });

        // Ambiguity is the planner's job, not this shortcut's. A unique exact
        // match is the only case where the goal names one control and only one.
        if (matches.length !== 1) {
            return null;
        }

        return [
            { action: "click", element: matches[0] },
            { action: "finish", value: `Clicked ${matches[0].text}` }
        ];

    }

}

module.exports = DirectPlanner;
