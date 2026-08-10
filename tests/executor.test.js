const { test } = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");

const Executor = require("../src/executor");
const LocatorCache = require("../src/cache/locatorCache");
const LocatorBuilder = require("../src/browser/locatorBuilder");
const VariableResolver = require("../src/variables/variableResolver");

function fakeSetup(overrides = {}) {

    const calls = [];

    const locator = {
        fill: async value => calls.push(["fill", value]),
        click: async () => calls.push(["click"]),
        press: async key => calls.push(["press", key]),
        selectOption: async value => calls.push(["select", value])
    };

    const browser = {
        page: {
            url: () => "https://example.com/login",
            goto: async url => calls.push(["goto", url]),
            waitForTimeout: async ms => calls.push(["wait", ms]),
            keyboard: { press: async key => calls.push(["press", key]) },
            mouse: { wheel: async (x, y) => calls.push(["scroll", y]) }
        }
    };

    const executor = new Executor(
        browser,
        VariableResolver.fromJob({ USERNAME: "bob", PASSWORD: "hunter2" }),
        {
            resolver: { resolve: async () => locator },
            watcher: { settle: async () => {} },
            locatorCache: new LocatorCache(
                path.join(os.tmpdir(), `agent-test-locators-${Date.now()}.json`)
            ),
            ...overrides
        }
    );

    return { executor, calls };

}

const ELEMENT = {
    elementId: 1,
    fingerprint: "input|name:username",
    role: "input",
    name: "username",
    locators: [{ type: "name", value: "username" }]
};

test("fill resolves a variable by name, never a literal secret in the plan", async () => {

    const { executor, calls } = fakeSetup();

    await executor.execute({ action: "fill", source: "PASSWORD", element: ELEMENT });

    assert.deepEqual(calls, [["fill", "hunter2"]]);

});

test("fill expands ${VAR} inside a literal value", async () => {

    const { executor, calls } = fakeSetup();

    await executor.execute({ action: "fill", value: "user-${USERNAME}", element: ELEMENT });

    assert.deepEqual(calls, [["fill", "user-bob"]]);

});

test("fill with an unknown variable fails loudly", async () => {

    const { executor } = fakeSetup();

    await assert.rejects(
        () => executor.execute({ action: "fill", source: "NOPE", element: ELEMENT }),
        /Unknown variable: NOPE/
    );

});

test("click, press, select, scroll, goto and wait all reach the page", async () => {

    const { executor, calls } = fakeSetup();

    await executor.execute({ action: "click", element: ELEMENT });
    await executor.execute({ action: "press", key: "Enter", element: ELEMENT });
    await executor.execute({ action: "select", value: "free", element: ELEMENT });
    await executor.execute({ action: "scroll", value: "down" });
    await executor.execute({ action: "goto", url: "https://example.com" });
    await executor.execute({ action: "wait", ms: 50 });

    assert.deepEqual(calls, [
        ["click"],
        ["press", "Enter"],
        ["select", "free"],
        ["scroll", 600],
        ["goto", "https://example.com"],
        ["wait", 50]
    ]);

});

test("unknown actions are rejected", async () => {

    const { executor } = fakeSetup();

    await assert.rejects(
        () => executor.execute({ action: "teleport" }),
        /Unknown action: teleport/
    );

});

test("locatorBuilder rebuilds strategies from a fingerprint alone", () => {

    const strategies = new LocatorBuilder().build({
        fingerprint: "button|text:Log in",
        role: "button",
        tag: "BUTTON"
    });

    assert.ok(
        strategies.some(item => item.type === "role" && item.value === "Log in"),
        "role locator rebuilt"
    );

    assert.ok(strategies.some(item => item.type === "css"), "css fallback present");

});

test("locatorCache remembers and forgets the winning strategy", () => {

    const cache = new LocatorCache(
        path.join(os.tmpdir(), `agent-test-locators-${Date.now()}-2.json`)
    );

    cache.save("example.com", "input|name:username", { type: "name", value: "username" });

    assert.deepEqual(
        cache.get("example.com", "input|name:username"),
        { type: "name", value: "username" }
    );

    cache.forget("example.com", "input|name:username");

    assert.equal(cache.get("example.com", "input|name:username"), null);

});
