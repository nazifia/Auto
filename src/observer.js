const { pageSignature } = require("./utils/fingerprint");

class Observer {

    constructor(browser) {

        this.browser = browser;

    }

    async observe() {

        const page = this.browser.page;

        const elements = await page.evaluate(() => {

            let nextId = 1;

            const results = [];
            const seen = new Set();

            function visible(el) {

                const style = window.getComputedStyle(el);

                return (
                    style.display !== "none" &&
                    style.visibility !== "hidden" &&
                    style.opacity !== "0" &&
                    (
                        el.offsetWidth > 0 ||
                        el.offsetHeight > 0 ||
                        el.getClientRects().length > 0
                    )
                );

            }

            function labelOf(el) {

                if (el.labels && el.labels.length > 0) {
                    return el.labels[0].innerText.trim();
                }

                return el.getAttribute("aria-label") || "";

            }

            function textOf(el) {

                const own = (el.innerText || el.value || "").trim();

                if (own) {
                    return own;
                }

                return (el.getAttribute("aria-label") || el.title || "").trim();

            }

            // Stable across reloads: prefer identity attributes over text.
            function fingerprint(el, role) {

                const label = labelOf(el);
                const text = textOf(el);

                if (el.id) return `${role}|id:${el.id}`;
                if (el.name) return `${role}|name:${el.name}`;
                if (el.placeholder) return `${role}|placeholder:${el.placeholder.toLowerCase()}`;
                if (label) return `${role}|label:${label.toLowerCase()}`;
                if (text) return `${role}|text:${text.toLowerCase()}`;
                if (el.getAttribute("href")) return `${role}|href:${el.getAttribute("href")}`;

                return `${role}|tag:${el.tagName.toLowerCase()}`;

            }

            function buildLocators(el, role) {

                const locators = [];
                const label = labelOf(el);
                const text = textOf(el);

                if (el.id) locators.push({ type: "id", value: el.id });
                if (el.name) locators.push({ type: "name", value: el.name });
                if (el.placeholder) locators.push({ type: "placeholder", value: el.placeholder });
                if (label) locators.push({ type: "label", value: label });

                if (text && text.length < 80) {
                    locators.push({ type: "role", role, value: text });
                }

                if (el.getAttribute("data-testid")) {
                    locators.unshift({
                        type: "css",
                        value: `[data-testid="${el.getAttribute("data-testid")}"]`
                    });
                }

                let css = el.tagName.toLowerCase();

                if (el.type) css += `[type="${el.type}"]`;
                if (el.name) css += `[name="${el.name}"]`;

                locators.push({ type: "css", value: css });

                return locators;

            }

            function addElement(el, role) {

                // The same node can match several selectors below.
                if (seen.has(el)) {
                    return;
                }

                seen.add(el);

                if (!visible(el)) {
                    return;
                }

                results.push({

                    elementId: nextId++,
                    fingerprint: fingerprint(el, role),
                    role,
                    tag: el.tagName,
                    text: textOf(el),
                    label: labelOf(el),
                    type: el.type || "",
                    placeholder: el.placeholder || "",
                    value: el.value || "",
                    id: el.id || "",
                    name: el.name || "",
                    href: el.getAttribute("href") || "",
                    visible: true,
                    clickable: role === "button" || role === "link" || role === "tab",
                    disabled: !!el.disabled,
                    checked: el.checked === undefined ? null : !!el.checked,
                    readonly: !!el.readOnly,
                    required: !!el.required,
                    locators: buildLocators(el, role)

                });

            }

            const groups = [
                ["button, input[type='submit'], input[type='button'], [role='button']", "button"],
                ["input:not([type='submit']):not([type='button']):not([type='hidden'])", "input"],
                ["textarea, [contenteditable='true']", "textarea"],
                ["select", "select"],
                ["[role='tab']", "tab"],
                ["a[href]", "link"]
            ];

            for (const [selector, role] of groups) {

                document.querySelectorAll(selector).forEach(el => addElement(el, role));

            }

            return results;

        });

        const url = page.url();

        let host = "";

        try {
            host = new URL(url).hostname;
        }
        catch {
            // about:blank and data: URLs have no host.
        }

        const info = {
            url,
            host,
            title: await page.title(),
            text: await page.locator("body").innerText().catch(() => ""),
            elements
        };

        info.signature = pageSignature(info);

        return info;

    }

}

module.exports = Observer;
