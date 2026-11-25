const { test } = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");

const MultiActionPlanner = require("../src/planning/multiActionPlanner");
const PlanValidator = require("../src/planning/planValidator");
const ConditionalPlanner = require("../src/planning/conditionalPlanner");
const DirectPlanner = require("../src/planning/directPlanner");
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

test("directPlanner turns a uniquely named control into click + finish", () => {

    const page = {
        elements: [
            { role: "button", text: "Run until 1 month from today" },
            { role: "link", text: "Web" },
            { role: "link", text: "Account" }
        ]
    };

    const actions = new DirectPlanner().plan(
        "Click Run until 1 month from today now - always click it, even if the page already shows the new date",
        page
    );

    assert.equal(actions.length, 2);
    assert.equal(actions[0].action, "click");
    assert.equal(actions[0].element.text, "Run until 1 month from today");
    assert.equal(actions[1].action, "finish");

    // The "button" suffix and articles are prose, not part of the name.
    const threeMonths = {
        elements: [{ role: "button", text: "Run until 3 months from today" }]
    };

    assert.ok(
        new DirectPlanner().plan("Click the Run until 3 months from today button", threeMonths)
    );

});

test("directPlanner leaves ambiguity and non-click goals to the planner", () => {

    const planner = new DirectPlanner();

    const duplicated = {
        elements: [
            { role: "button", text: "Extend" },
            { role: "button", text: "Extend" }
        ]
    };

    assert.equal(planner.plan("Click Extend", duplicated), null, "two matches are ambiguous");
    assert.equal(planner.plan("Open the Web tab", { elements: [] }), null, "not a click goal");
    assert.equal(planner.plan("Click Extend", { elements: [] }), null, "no visible match");
    assert.equal(
        planner.plan("Click the button", { elements: [{ role: "button", text: "button" }] }),
        null,
        "a generic noun is not a control's name"
    );
    assert.equal(
        planner.plan("Click Extend", { elements: [{ role: "button", text: "Extend", disabled: true }] }),
        null,
        "a disabled control is not clickable"
    );

});

test("planner clicks an explicitly named button without calling the LLM", async () => {

    const planner = new Planner({
        plannerCache: new PlannerCache(tmp("planner-cache-direct.json")),
        confidenceModel: { plan: () => 1, element: () => 1 },
        multiActionPlanner: {
            plan: async () => {
                throw new Error("the goal names a visible button; the LLM must not be asked");
            }
        }
    });

    const page = {
        ...PAGE,
        elements: [
            { role: "button", text: "Run until 1 month from today", fingerprint: "button|text:run until 1 month from today" }
        ]
    };

    const result = await planner.plan({
        goal: "Click Run until 1 month from today now - always click it, even if the page already shows the new date",
        page,
        variables: []
    });

    assert.equal(result.source, "direct");
    assert.equal(result.actions[0].action, "click");
    assert.equal(result.actions[1].action, "finish");

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
