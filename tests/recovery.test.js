const { test } = require("node:test");
const assert = require("node:assert");

const RecoveryManager = require("../src/recoveryManager");
const LocatorResolver = require("../src/browser/locatorResolver");

const BOOM = new Error("click timed out");

function fakeRecovery() {
    const moves = [];

    const manager = new RecoveryManager({
        maxRetries: 3,
        rollback: {
            reset: () => {},
            run: async () => moves.push("rollback:run")
        },
        replanner: {
            invalidate: () => moves.push("replanner:invalidate"),
            consume: () => false
        }
    });

    // The real Retry sleeps between attempts; the ladder's order is the point.
    manager.retry.backoff = async () => {};

    return { manager, moves };
}

test("the escalation ladder is retry, replan, rollback, abort", async () => {

    const { manager, moves } = fakeRecovery();

    const decisions = [];

    for (let i = 0; i < 4; i++) {
        decisions.push(await manager.handle(BOOM, { host: "example.com", goal: "Log in" }));
    }

    assert.deepEqual(decisions, ["retry", "replan", "rollback", "abort"]);

    assert.deepEqual(moves, ["replanner:invalidate", "rollback:run"]);

});

test("a failed cached plan skips the retry rung — it is stale, not unlucky", async () => {

    const { manager } = fakeRecovery();

    const first = await manager.handle(BOOM, { goal: "Log in", source: "cache" });

    assert.equal(first, "replan");

});

test("recovery aborts even with no rollback available", async () => {

    const manager = new RecoveryManager({ maxRetries: 2 });

    manager.retry.backoff = async () => {};

    assert.equal(await manager.handle(BOOM, { goal: "Log in" }), "retry");
    assert.equal(await manager.handle(BOOM, { goal: "Log in" }), "abort");

});

test("a dead end invalidates the plan and rolls back without counting a failure", async () => {

    const { manager, moves } = fakeRecovery();

    await manager.handleDeadEnd({ host: "example.com", goal: "Log in", signature: "sig" });

    assert.deepEqual(moves, ["replanner:invalidate", "rollback:run"]);

    // Dead ends are not action failures: the retry budget must be untouched.
    assert.equal(manager.retry.attempts, 0);

});

// --- locator resolution ------------------------------------------------------

function fakePage(matches) {

    const made = [];

    const locatorFor = value => {

        const count = matches[value] ?? 0;

        const node = {
            count: async () => count,
            isVisible: async () => count > 0,
            first: () => node,
            marker: value
        };

        made.push(value);

        return node;

    };

    return {
        made,
        page: {
            locator: selector => locatorFor(selector),
            getByPlaceholder: value => locatorFor(`placeholder:${value}`),
            getByLabel: value => locatorFor(`label:${value}`),
            getByRole: (role, options) => locatorFor(`role:${options.name}`),
            getByText: value => locatorFor(`text:${value}`)
        }
    };

}

const INPUT = {
    fingerprint: "input|name:username",
    role: "input",
    name: "username",
    placeholder: "Username"
};

test("locatorResolver tries the cached strategy before anything else", async () => {

    const { page, made } = fakePage({ '[name="username"]': 1 });

    const cache = {
        get: () => ({ type: "name", value: "username" }),
        save: () => {},
        forget: () => { throw new Error("should not forget a strategy that worked"); }
    };

    const resolver = new LocatorResolver({ page }, cache);

    const locator = await resolver.resolve(INPUT, "example.com");

    assert.equal(locator.marker, '[name="username"]');

    assert.equal(made.length, 1, "a cached hit costs exactly one lookup");

});

test("locatorResolver prefers a unique match over an ambiguous earlier one", async () => {

    // The placeholder matches three nodes, the name exactly one.
    const { page } = fakePage({
        "placeholder:Username": 3,
        '[name="username"]': 1
    });

    const saved = [];

    const resolver = new LocatorResolver({ page }, {
        get: () => ({ type: "placeholder", value: "Username" }),
        save: (host, key, strategy) => saved.push(strategy.type),
        forget: () => {}
    });

    const locator = await resolver.resolve(INPUT, "example.com");

    assert.equal(locator.marker, '[name="username"]');

    assert.deepEqual(saved, ["name"], "the unique strategy is what gets remembered");

});

test("locatorResolver forgets a cached strategy once nothing matches", async () => {

    const { page } = fakePage({});

    const forgotten = [];

    const resolver = new LocatorResolver({ page }, {
        get: () => ({ type: "name", value: "username" }),
        save: () => {},
        forget: (host, key) => forgotten.push(key)
    });

    await assert.rejects(
        () => resolver.resolve(INPUT, "example.com"),
        /Unable to locate element/
    );

    assert.equal(forgotten.length, 1);

});
