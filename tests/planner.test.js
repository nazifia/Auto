const { test } = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");

const MultiActionPlanner = require("../src/planning/multiActionPlanner");
const PlanValidator = require("../src/planning/planValidator");
const ConditionalPlanner = require("../src/planning/conditionalPlanner");
const PlannerCache = require("../src/memory/plannerCache");
const Planner = require("../src/planner");

const PAGE = {
    url: "https://example.com/login",
    host: "example.com",
    title: "Login",
    text: "Username Password Log in",
    elements: [
        {
            elementId: 1,
            fingerprint: "input|name:username",
            role: "input",
            text: "",
            placeholder: "Username",
            locators: [{ type: "name", value: "username" }]
        },
        {
            elementId: 2,
            fingerprint: "button|text:log in",
            role: "button",
            text: "Log in",
            locators: [{ type: "role", role: "button", value: "Log in" }]
        }
    ]
};

const fakeAi = reply => ({ chat: async () => reply });

const tmp = name => path.join(os.tmpdir(), `agent-test-${Date.now()}-${name}`);

test("multiActionPlanner maps elementId to the observed element", async () => {

    const planner = new MultiActionPlanner(fakeAi(JSON.stringify({
        reason: "log in",
        actions: [
            { action: "fill", elementId: 1, source: "USERNAME" },
            { action: "click", elementId: 2 }
        ]
    })));

    const actions = await planner.plan({ goal: "Log in", page: PAGE, variables: ["USERNAME"] });

    assert.equal(actions.length, 2);
    assert.equal(actions[0].element.fingerprint, "input|name:username");
    assert.equal(actions[0].elementId, undefined, "raw elementId is dropped");
    assert.equal(actions[1].element.role, "button");

});

test("multiActionPlanner rejects an invented elementId", async () => {

    const planner = new MultiActionPlanner(fakeAi(JSON.stringify({
        actions: [{ action: "click", elementId: 99 }]
    })));

    await assert.rejects(
        () => planner.plan({ goal: "Log in", page: PAGE }),
        /unknown elementId: 99/
    );

});

test("multiActionPlanner survives fenced JSON", async () => {

    const planner = new MultiActionPlanner(fakeAi(
        "```json\n{ \"actions\": [ { \"action\": \"wait\", \"ms\": 500 } ] }\n```"
    ));

    const actions = await planner.plan({ goal: "Wait", page: PAGE });

    assert.equal(actions[0].action, "wait");

});

test("planValidator catches malformed plans", () => {

    const validator = new PlanValidator();

    assert.throws(() => validator.validate([]), /empty plan/);
    assert.throws(() => validator.validate([{ action: "explode" }]), /unknown action/);
    assert.throws(() => validator.validate([{ action: "goto" }]), /missing 'url'/);
    assert.throws(() => validator.validate([{ action: "click" }]), /no resolved element/);
    assert.throws(
        () => validator.validate([{ action: "fill", element: PAGE.elements[0] }]),
        /needs 'source' or 'value'/
    );

    assert.ok(validator.validate([{ action: "goto", url: "https://example.com" }]));

});

test("planValidator detects a stale element between batched actions", () => {

    const validator = new PlanValidator();

    const action = { action: "click", element: PAGE.elements[1] };

    assert.equal(validator.stillValid(action, PAGE), true);
    assert.equal(validator.stillValid(action, { elements: [PAGE.elements[0]] }), false);

});

test("conditionalPlanner honours when-guards", () => {

    const conditional = new ConditionalPlanner();

    assert.equal(
        conditional.shouldRun({ action: "click", when: { exists: "Log in" } }, PAGE),
        true
    );

    assert.equal(
        conditional.shouldRun({ action: "click", when: { exists: "Log out" } }, PAGE),
        false
    );

    assert.equal(
        conditional.shouldRun({ action: "click", when: { missing: "Log out" } }, PAGE),
        true
    );

    assert.equal(
        conditional.shouldRun({ action: "click", when: { url: "/login" } }, PAGE),
        true
    );

    assert.equal(conditional.shouldRun({ action: "click" }, PAGE), true);

});

test("planner reuses a cached plan instead of calling the LLM", async () => {

    let llmCalls = 0;

    const llm = {
        plan: async () => {
            llmCalls++;
            return [{ action: "click", element: PAGE.elements[1] }];
        }
    };

    const planner = new Planner({
        plannerCache: new PlannerCache(tmp("planner-cache.json")),
        confidenceModel: { plan: () => 1, element: () => 1 },
        multiActionPlanner: llm
    });

    const context = { goal: "Log in", page: PAGE, variables: [] };

    const first = await planner.plan(context);

    assert.equal(first.source, "llm");
    assert.equal(llmCalls, 1);

    const second = await planner.plan(context);

    assert.equal(second.source, "cache");
    assert.equal(llmCalls, 1, "no second LLM call");
    assert.equal(second.actions[0].element.fingerprint, "button|text:log in");

});

test("planner falls back to the LLM when the cached element is gone", async () => {

    let llmCalls = 0;

    const llm = {
        plan: async () => {
            llmCalls++;
            return [{ action: "click", element: PAGE.elements[1] }];
        }
    };

    const planner = new Planner({
        plannerCache: new PlannerCache(tmp("planner-cache-2.json")),
        confidenceModel: { plan: () => 1, element: () => 1 },
        multiActionPlanner: llm
    });

    await planner.plan({ goal: "Log in", page: PAGE, variables: [] });

    // Same page signature is impossible once the button is gone, but the cache
    // must also refuse to hydrate a plan whose target vanished.
    const changed = { ...PAGE, elements: [PAGE.elements[0]] };

    await planner.plan({ goal: "Log in", page: changed, variables: [] });

    assert.equal(llmCalls, 2);

});
