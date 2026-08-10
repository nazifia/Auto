function hash(text) {

    let value = 5381;

    const input = String(text);

    for (let index = 0; index < input.length; index++) {

        value = ((value * 33) ^ input.charCodeAt(index)) >>> 0;

    }

    return value.toString(36);

}

function normalize(text) {

    return String(text || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

}

// Falls back to a derived key when the observer could not attach one.
function elementKey(element) {

    if (!element) {
        return "";
    }

    if (element.fingerprint) {
        return element.fingerprint;
    }

    return [
        element.role,
        element.id || element.name || element.placeholder || normalize(element.text)
    ].join("|");

}

// Stable across value/state changes so plan caching can key on it.
function pageSignature(page) {

    if (!page) {
        return "";
    }

    let pathname = page.url || "";

    try {
        pathname = new URL(page.url).host + new URL(page.url).pathname;
    }
    catch {
        // Non-URL page (about:blank, data:) — use it verbatim.
    }

    const keys = (page.elements || [])
        .map(elementKey)
        .filter(Boolean)
        .sort();

    return hash(pathname + "::" + keys.join("|"));

}

module.exports = { hash, normalize, elementKey, pageSignature };
