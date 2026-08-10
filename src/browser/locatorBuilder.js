// Rebuilds locator strategies for an element that came from memory/cache and
// therefore has no fresh `locators` array attached.
class LocatorBuilder {

    build(element) {

        if (!element) {
            return [];
        }

        if (Array.isArray(element.locators) && element.locators.length > 0) {
            return element.locators;
        }

        return this.fromFingerprint(element);

    }

    fromFingerprint(element) {

        const locators = [];

        const push = (type, value, role) => {

            if (value) {
                locators.push(role ? { type, value, role } : { type, value });
            }

        };

        push("id", element.id);
        push("name", element.name);
        push("placeholder", element.placeholder);
        push("label", element.label);

        if (element.text) {
            push("role", element.text, element.role);
            push("text", element.text);
        }

        // fingerprint format: "role|kind:value"
        const parts = String(element.fingerprint || "").split("|");

        if (parts.length === 2) {

            const role = parts[0];
            const separator = parts[1].indexOf(":");
            const kind = parts[1].slice(0, separator);
            const value = parts[1].slice(separator + 1);

            if (kind === "id") push("id", value);
            if (kind === "name") push("name", value);
            if (kind === "placeholder") push("placeholder", value);
            if (kind === "label") push("label", value);
            if (kind === "href") push("css", `a[href="${value}"]`);
            if (kind === "text") push("role", value, role);

        }

        if (element.tag) {

            let css = String(element.tag).toLowerCase();

            if (element.type) css += `[type="${element.type}"]`;
            if (element.name) css += `[name="${element.name}"]`;

            push("css", css);

        }

        // Drop duplicates while keeping the strongest strategy first.
        const seen = new Set();

        return locators.filter(strategy => {

            const key = `${strategy.type}:${strategy.role || ""}:${strategy.value}`;

            if (seen.has(key)) {
                return false;
            }

            seen.add(key);

            return true;

        });

    }

}

module.exports = LocatorBuilder;
