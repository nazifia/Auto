const { test } = require("node:test");
const assert = require("node:assert");

const Browser = require("../src/browser");
const Observer = require("../src/observer");

const HTML = `
    <form>
        <label for="user">Username</label>
        <input id="user" name="username" placeholder="Username">
        <input name="password" type="password" placeholder="Password">
        <input type="hidden" name="csrf" value="abc">
        <select name="plan"><option value="free">Free</option></select>
        <button type="submit">Log in</button>
    </form>
    <a href="/web">Web</a>
    <div style="display:none"><button>Invisible</button></div>
`;

test("observer extracts visible, fingerprinted, locatable elements", async t => {

    const browser = new Browser({ headless: true, slowMo: 0 });

    try {
        await browser.start();
    }
    catch (error) {
        t.skip(`Playwright browser unavailable: ${error.message}`);
        return;
    }

    // Unconditional: an assertion failure must not leave chromium running.
    t.after(() => browser.close());

    await browser.page.setContent(HTML);

    const page = await new Observer(browser).observe();

    const byName = name => page.elements.find(element => element.name === name);

    assert.ok(page.signature, "page has a signature");

    assert.ok(byName("username"), "username input observed");
    assert.equal(byName("username").role, "input");
    assert.equal(byName("username").fingerprint, "input|id:user");

    assert.ok(byName("password").locators.length > 1, "multiple locator strategies");

    assert.ok(
        page.elements.some(element => element.role === "button" && element.text === "Log in"),
        "submit button observed"
    );

    assert.ok(
        page.elements.some(element => element.role === "link" && element.text === "Web"),
        "link observed"
    );

    assert.equal(byName("csrf"), undefined, "hidden input excluded");

    assert.equal(
        page.elements.filter(element => element.text === "Invisible").length,
        0,
        "invisible element excluded"
    );

    const ids = page.elements.map(element => element.elementId);

    assert.equal(new Set(ids).size, ids.length, "elementIds are unique");

});
