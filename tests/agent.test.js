const { test } = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");

const { Agent } = require("../src/agent");
const Brain = require("../src/brain");
const GoalVerifier = require("../src/planning/goalVerifier");
const GoalManager = require("../src/goalManager");
const WorkflowMemory = require("../src/memory/workflowMemory");
const VariableLearning = require("../src/variables/variableLearning");
const VariableResolver = require("../src/variables/variableResolver");
const plugins = require("../src/plugins");

const scratch = name => path.join(os.tmpdir(), `agent-unit-${process.pid}-${name}`);

const PAGE = {
    url: "https://example.com/dashboard",
    host: "example.com",
    title: "Dashboard",
    text: "Welcome back. Your dashboard is ready.",
    elements: [
        {
            elementId: 1,
            fingerprint: "input|name:username",
            role: "input",
            text: "",
            placeholder: "Username"
        }
    ]
};

test("goalVerifier accepts a claim the page supports", () => {

    const verifier = new GoalVerifier();

    const result = verifier.accept("Log in", "Dashboard is visible", PAGE);

    assert.equal(result.accepted, true);
    assert.ok(result.score > 0);

});

test("goalVerifier rejects a claim nothing on the page supports", () => {

    const verifier = new GoalVerifier();

    const result = verifier.accept("Log in", "Invoice PDF has downloaded", PAGE);

    assert.equal(result.accepted, false);
    assert.equal(result.score, 0);
    assert.match(result.reason, /none of/);

});

test("goalVerifier gives up rejecting rather than stalling the job", () => {

    const verifier = new GoalVerifier();

    const hint = "Invoice PDF has downloaded";

    assert.equal(verifier.accept("Log in", hint, PAGE).accepted, false);

    const second = verifier.accept("Log in", hint, PAGE);

    assert.equal(second.accepted, true, "second claim is taken on trust");
    assert.equal(second.forced, true);

});

test("goalVerifier passes goals that have no done hint", () => {

    assert.equal(new GoalVerifier().accept("Log in", null, PAGE).accepted, true);

});

test("brain annotates elements with the variable learned for that field", () => {

    const learning = new VariableLearning(scratch("varlearn.json"));

    learning.learn("example.com", "USERNAME", PAGE.elements[0]);

    const brain = new Brain({
        siteKnowledge: { get: () => null, save: () => {} },
        variableLearning: learning
    });

    const context = brain.buildContext({
        goal: "Log in",
        page: PAGE,
        state: {},
        history: [],
        variables: ["USERNAME"]
    });

    assert.equal(context.page.elements[0].variable, "USERNAME");

});

test("brain surfaces a known workflow and recent failures", () => {

    const workflows = new WorkflowMemory(scratch("workflows.json"));

    workflows.save("example.com", "log in daily", [
        { action: "fill", source: "USERNAME", element: { fingerprint: "input|name:username" } },
        { action: "click", element: { fingerprint: "button|text:log in" } }
    ]);

    const brain = new Brain({
        siteKnowledge: { get: () => null, save: () => {} },
        workflowMemory: workflows
    });

    const history = [
        { action: "click", ok: true },
        { action: "click", ok: false, element: { fingerprint: "button|text:next" } }
    ];

    const context = brain.buildContext({
        goal: "Log in",
        task: "log in daily",
        page: PAGE,
        state: {},
        history,
        variables: []
    });

    assert.equal(context.workflow.steps.length, 2);
    assert.ok(context.workflow.confidence > 0);
    assert.equal(context.failures.length, 1);
    assert.equal(context.failures[0].element.fingerprint, "button|text:next");

});

test("brain reports no workflow for an unknown task", () => {

    const brain = new Brain({
        siteKnowledge: { get: () => null, save: () => {} },
        workflowMemory: new WorkflowMemory(scratch("workflows-empty.json"))
    });

    const context = brain.buildContext({
        goal: "Log in",
        task: "never seen before",
        page: PAGE,
        state: {},
        history: [],
        variables: []
    });

    assert.equal(context.workflow, null);

});

test("brain does not learn from actions that failed", () => {

    const saved = [];

    const brain = new Brain({
        siteKnowledge: { get: () => null, save: (url, data) => saved.push(data) }
    });

    brain.learn(PAGE, [
        {
            action: "click",
            ok: false,
            element: { text: "Log in", role: "button", fingerprint: "button|text:log in" }
        }
    ]);

    assert.equal(saved.length, 0, "a failed click is not site knowledge");

});

test("agent runs a plugin step, resolving variables and storing the result", async () => {

    plugins.registry.echo = () => ({ run: async payload => ({ echoed: payload }) });

    const agent = new Agent({
        brain: new Brain({ siteKnowledge: { get: () => null, save: () => {} } })
    });

    const variables = VariableResolver.fromJob({ USERNAME: "bob" });

    const result = await agent.runPluginStep(
        {
            goal: "call the API",
            plugin: "echo",
            request: { url: "https://example.com/${USERNAME}" },
            saveAs: "REPLY"
        },
        variables
    );

    assert.deepEqual(result.echoed.url, "https://example.com/bob");
    assert.match(variables.get("REPLY"), /example\.com\/bob/);

    delete plugins.registry.echo;

});

test("plugin steps become goals, and unknown plugins fail loudly", async () => {

    const goals = new GoalManager([
        { plugin: "api", request: { url: "https://example.com" } },
        { goal: "Log in" }
    ]);

    assert.equal(goals.current(), "run api");
    assert.equal(goals.step().plugin, "api");

    await assert.rejects(() => plugins.run("telepathy", {}), /Unknown plugin: telepathy/);

});

test("agent derives one session file per host", () => {

    const agent = new Agent({
        brain: new Brain({ siteKnowledge: { get: () => null, save: () => {} } })
    });

    assert.match(
        agent.sessionFile("https://www.pythonanywhere.com/login/"),
        /sessions[\\/]www\.pythonanywhere\.com\.json$/
    );

    assert.match(agent.sessionFile("not a url"), /sessions[\\/]default\.json$/);

});
