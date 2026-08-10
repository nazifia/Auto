const path = require("path");

const { readJson, writeJson } = require("../utils/json");

// host -> fingerprint -> { success, fail, last }
class ElementMemory {

    constructor(file = path.join(__dirname, "elementMemory.json")) {

        this.file = file;
        this.memory = this.load();

    }

    load() {

        const raw = readJson(this.file, {});

        // Migrate the old "fingerprint -> count" shape.
        for (const host of Object.keys(raw)) {

            for (const [fingerprint, value] of Object.entries(raw[host])) {

                if (typeof value === "number") {
                    raw[host][fingerprint] = { success: value, fail: 0, last: null };
                }

            }

        }

        return raw;

    }

    entry(host, fingerprint) {

        if (!host || !fingerprint) {
            return null;
        }

        this.memory[host] = this.memory[host] || {};

        this.memory[host][fingerprint] = this.memory[host][fingerprint]
            || { success: 0, fail: 0, last: null };

        return this.memory[host][fingerprint];

    }

    learn(host, fingerprint) {

        const entry = this.entry(host, fingerprint);

        if (!entry) {
            return;
        }

        entry.success++;
        entry.last = new Date().toISOString();

        this.save();

    }

    fail(host, fingerprint) {

        const entry = this.entry(host, fingerprint);

        if (!entry) {
            return;
        }

        entry.fail++;
        entry.last = new Date().toISOString();

        this.save();

    }

    stats(host, fingerprint) {

        return this.memory[host]?.[fingerprint] || { success: 0, fail: 0, last: null };

    }

    // Raw success count, used as a ranking boost.
    score(host, fingerprint) {

        return this.stats(host, fingerprint).success;

    }

    save() {

        writeJson(this.file, this.memory);

    }

}

module.exports = ElementMemory;
