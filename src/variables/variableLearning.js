const path = require("path");

const { readJson, writeJson } = require("../utils/json");
const { elementKey } = require("../utils/fingerprint");

// Remembers which field each variable belongs in, per host, so future runs can
// fill forms without asking the planner which box is the password.
class VariableLearning {

    constructor(file = path.join(__dirname, "..", "memory", "variables.json")) {

        this.file = file;
        this.data = readJson(this.file, {});

    }

    learn(host, source, element) {

        const key = elementKey(element);

        if (!host || !source || !key) {
            return;
        }

        this.data[host] = this.data[host] || {};

        const entry = this.data[host][source] || { fingerprint: key, count: 0 };

        // A new field wins only once it is used as often as the old one.
        if (entry.fingerprint === key) {
            entry.count++;
        }
        else if (entry.count <= 1) {
            entry.fingerprint = key;
            entry.count = 1;
        }
        else {
            entry.count--;
        }

        this.data[host][source] = entry;

        writeJson(this.file, this.data);

    }

    // Which variable belongs in this element, if any.
    suggest(host, element) {

        const key = elementKey(element);

        const known = this.data[host] || {};

        for (const [source, entry] of Object.entries(known)) {

            if (entry.fingerprint === key) {
                return source;
            }

        }

        return null;

    }

    all(host) {

        return this.data[host] || {};

    }

}

module.exports = VariableLearning;
