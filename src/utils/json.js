const fs = require("fs");
const path = require("path");

// Models wrap JSON in prose or ```json fences often enough to be worth handling.
function extract(text) {

    if (typeof text !== "string") {
        return text;
    }

    let out = text.trim();

    const fence = out.match(/```(?:json)?\s*([\s\S]*?)```/i);

    if (fence) {
        out = fence[1].trim();
    }

    const first = out.search(/[[{]/);

    if (first === -1) {
        return out;
    }

    const open = out[first];
    const close = open === "{" ? "}" : "]";
    const last = out.lastIndexOf(close);

    return last > first
        ? out.slice(first, last + 1)
        : out.slice(first);

}

function parse(text, fallback) {

    try {
        return JSON.parse(extract(text));
    }
    catch (error) {

        if (arguments.length > 1) {
            return fallback;
        }

        throw new Error(`Invalid JSON:\n${text}`);

    }

}

function readJson(file, fallback) {

    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    }
    catch {
        return fallback;
    }

}

// Write through a temp file and rename. Memory files are rewritten whole on
// every learned action, so a crash mid-write leaves a truncated file — and
// readJson swallows that into its fallback, losing every run's learning
// without a word. rename is atomic on the same filesystem.
function writeJson(file, data) {

    fs.mkdirSync(path.dirname(file), { recursive: true });

    const temp = `${file}.${process.pid}.tmp`;

    fs.writeFileSync(temp, JSON.stringify(data, null, 4));

    // On Windows the rename fails with EPERM while something else (Defender,
    // the search indexer, an editor) briefly holds the target open. The lock
    // clears in milliseconds; a job must not fail over it.
    for (let attempt = 0; ; attempt++) {

        try {
            return fs.renameSync(temp, file);
        }
        catch (error) {

            if (attempt >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) {
                throw error;
            }

            const until = Date.now() + 50 * (attempt + 1);

            while (Date.now() < until) { /* sync caller, sync wait */ }

        }

    }

}

module.exports = { extract, parse, readJson, writeJson };
