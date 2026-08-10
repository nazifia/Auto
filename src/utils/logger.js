const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

const level = LEVELS[(process.env.LOG_LEVEL || "info").toLowerCase()] ?? LEVELS.info;

const SECRET_KEY = /(password|secret|token|api[-_]?key|credential)/i;

// Literal values registered here are scrubbed from every log line.
const secrets = new Set();

function addSecret(value) {

    if (typeof value === "string" && value.length >= 3) {

        secrets.add(value);

    }

}

function scrub(text) {

    let out = String(text);

    for (const secret of secrets) {

        out = out.split(secret).join("********");

    }

    return out;

}

function mask(value, depth = 0) {

    if (depth > 6) {
        return "[deep]";
    }

    if (typeof value === "string") {
        return scrub(value);
    }

    if (Array.isArray(value)) {
        return value.map(item => mask(item, depth + 1));
    }

    if (value && typeof value === "object") {

        const out = {};

        for (const [key, item] of Object.entries(value)) {

            out[key] = SECRET_KEY.test(key)
                ? "********"
                : mask(item, depth + 1);

        }

        return out;

    }

    return value;

}

function emit(min, method, args) {

    if (level < min) {
        return;
    }

    console[method](...args.map(arg => mask(arg)));

}

module.exports = {

    addSecret,

    mask,

    scrub,

    error: (...args) => emit(LEVELS.error, "error", args),

    warn: (...args) => emit(LEVELS.warn, "warn", args),

    info: (...args) => emit(LEVELS.info, "log", args),

    debug: (...args) => emit(LEVELS.debug, "log", args),

    section(title) {

        if (level < LEVELS.info) {
            return;
        }

        console.log("\n==============================");
        console.log(title);
        console.log("==============================");

    },

    table(rows) {

        if (level < LEVELS.info) {
            return;
        }

        console.table(mask(rows));

    }

};
