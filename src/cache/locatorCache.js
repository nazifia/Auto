const path = require("path");

const { readJson, writeJson } = require("../utils/json");

// host -> elementKey -> winning locator strategy
class LocatorCache {

    constructor(file = path.join(__dirname, "locators.json")) {

        this.file = file;
        this.data = readJson(this.file, {});

    }

    get(host, key) {

        return this.data[host]?.[key] || null;

    }

    save(host, key, strategy) {

        if (!host || !key || !strategy) {
            return;
        }

        if (JSON.stringify(this.get(host, key)) === JSON.stringify(strategy)) {
            return;
        }

        this.data[host] = this.data[host] || {};
        this.data[host][key] = strategy;

        writeJson(this.file, this.data);

    }

    forget(host, key) {

        if (this.data[host]?.[key]) {

            delete this.data[host][key];

            writeJson(this.file, this.data);

        }

    }

}

module.exports = LocatorCache;
