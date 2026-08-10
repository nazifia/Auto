const fs = require("fs");
const path = require("path");

const ImageAnalyzer = require("./imageAnalyzer");
const ScreenshotObserver = require("./screenshotObserver");
const MultiActionPlanner = require("../planning/multiActionPlanner");
const logger = require("../utils/logger");
const json = require("../utils/json");

// Same contract as src/planner.js, but it looks at the page instead of reading
// it. Used when the DOM shortlist is empty or the DOM planner is stuck.
class VisionPlanner {

    constructor(options = {}) {

        this.analyzer = options.analyzer || new ImageAnalyzer({
            ai: options.ai,
            model: options.model
        });

        this.observer = options.screenshotObserver
            || (options.browser ? new ScreenshotObserver(options.browser) : null);

        this.prompt = options.prompt || fs.readFileSync(
            path.join(__dirname, "..", "ai", "visionPrompt.txt"),
            "utf8"
        );

    }

    static compact(context) {

        return {

            goal: context.goal,

            done: context.done,

            variables: context.variables,

            state: context.state,

            page: {

                url: context.page.url,

                title: context.page.title,

                // Short list only: the screenshot carries the detail.
                elements: (context.page.elements || []).slice(0, 15).map(element => ({
                    elementId: element.elementId,
                    role: element.role,
                    text: element.text,
                    placeholder: element.placeholder
                }))

            }

        };

    }

    async plan(context) {

        if (!this.observer) {
            throw new Error("VisionPlanner has no screenshot observer.");
        }

        const shot = context.screenshot || await this.observer.observe();

        const payload = VisionPlanner.compact(context);

        const reply = await this.analyzer.ask(
            shot,
            `${this.prompt}\n\n${JSON.stringify(payload)}`
        );

        const parsed = json.parse(reply);

        const actions = Array.isArray(parsed)
            ? parsed
            : (parsed.actions || (parsed.action ? [parsed] : []));

        if (!Array.isArray(actions) || actions.length === 0) {
            throw new Error(`Vision planner returned no actions:\n${reply}`);
        }

        if (parsed.reason) {
            logger.info("Vision:", parsed.reason);
        }

        const resolved = MultiActionPlanner.attachElements(
            actions.slice(0, 3),
            context.page
        );

        return {
            actions: resolved.map(action => this.clamp(action, shot)),
            source: "vision",
            confidence: 0.5,
            screenshot: shot
        };

    }

    // A coordinate outside the viewport is a hallucination, not a click target.
    clamp(action, shot) {

        if (action.action !== "clickAt") {
            return action;
        }

        const x = Number(action.x);
        const y = Number(action.y);

        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error("clickAt is missing numeric x/y.");
        }

        if (shot.width && shot.height) {

            if (x < 0 || y < 0 || x > shot.width || y > shot.height) {
                throw new Error(
                    `clickAt (${x}, ${y}) is outside the ${shot.width}x${shot.height} viewport.`
                );
            }

        }

        return { ...action, x, y };

    }

    // The agent calls this on planners; vision plans are never cached.
    record() {}

    forget() {}

}

module.exports = VisionPlanner;
