const path = require("path");

const { readJson, writeJson } = require("../utils/json");

class History {

    constructor(file = path.join(__dirname, "actionHistory.json"), limit = 40) {

        this.file = file;
        this.limit = limit;
        this.actions = [];

    }

    static describe(action) {

        return {

            action: action.action,

            element: action.element
                ? {
                    elementId: action.element.elementId,
                    fingerprint: action.element.fingerprint,
                    role: action.element.role,
                    text: action.element.text,
                    placeholder: action.element.placeholder
                }
                : null,

            source: action.source || null,

            // Never store the resolved secret, only the variable name above.
            value: action.source ? null : (action.value ?? null),

            url: action.url || null,

            goal: action.goal || null,

            ok: action.ok !== false,

            time: new Date().toISOString()

        };

    }

    add(action) {

        const entry = History.describe(action);

        this.actions.push(entry);

        return entry;

    }

    get() {

        return this.actions;

    }

    // Only the tail goes into the prompt — older steps just cost tokens.
    recent(count = 8) {

        return this.actions.slice(-count);

    }

    clear() {

        this.actions = [];

    }

    persist(meta = {}) {

        const previous = readJson(this.file, []);

        previous.push({
            ...meta,
            time: new Date().toISOString(),
            actions: this.actions
        });

        writeJson(this.file, previous.slice(-this.limit));

    }

}

module.exports = History;
