const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { Agent } = require("../src/agent");
const Browser = require("../src/browser");
const Brain = require("../src/brain");
const ElementMemory = require("../src/memory/elementMemory");
const WorkflowMemory = require("../src/memory/workflowMemory");
const SiteMemory = require("../src/knowledge/siteMemory");
const LocatorCache = require("../src/cache/locatorCache");
const VariableLearning = require("../src/variables/variableLearning");
const Statistics = require("../src/learning/statistics");
const History = require("../src/memory/history");

const PAGE = `<!doctype html>
<html><body>
    <h1>Sign in</h1>
    <form id="form">
        <input name="username" placeholder="Username">
        <input name="password" type="password" placeholder="Password">
        <button type="submit">Log in</button>
    </form>
    <p id="error"></p>
    <script>
        document.getElementById("form").addEventListener("submit", function (event) {
            event.preventDefault();
            var user = document.querySelector("[name=username]").value;
            var pass = document.querySelector("[name=password]").value;
            if (pass === "hunter2") {
                document.body.innerHTML = "<h1>Welcome " + user + "</h1><a href='#'>Log out</a>";
            }
            else {
                // Form stays on screen, like a real failed login.
                document.getElementById("error").textContent = "Wrong password";
            }
        });
    </script>
</body></html>`;

// Stands in for the LLM: same contract as src/planner.js.
function scriptedPlanner() {

    const planner = {

        calls: 0,

        async plan(context) {

            planner.calls++;

            const find = predicate => context.page.elements.find(predicate);

            if (/Welcome/.test(context.page.text)) {

                return {
                    actions: [{ action: "finish", value: "logged in" }],
                    signature: context.page.signature,
                    source: "test"
                };

            }

            return {
                actions: [
                    { action: "fill", source: "USERNAME", element: find(e => e.name === "username") },
                    { action: "fill", source: "PASSWORD", element: find(e => e.name === "password") },
                    { action: "click", element: find(e => e.role === "button") }
                ],
                signature: context.page.signature,
                source: "test"
            };

        },

        record() {},
        forget() {}

    };

    return planner;

}

function scratch(name) {

    return path.join(os.tmpdir(), `agent-it-${process.pid}-${name}`);

}

// A page the DOM observer finds nothing on: the vision fallback's whole reason
// to exist.
const CANVAS_PAGE = `<!doctype html>
<html><body style="margin:0">
    <canvas id="board" width="400" height="300"></canvas>
    <script>
        var canvas = document.getElementById("board");
        canvas.addEventListener("click", function () {
            document.title = "clicked";
        });
    </script>
</body></html>`;

function isolatedMemory(suffix) {

    return {
        elementMemory: new ElementMemory(scratch(`elements-${suffix}.json`)),
        workflowMemory: new WorkflowMemory(scratch(`workflows-${suffix}.json`)),
        siteMemory: new SiteMemory(scratch(`sites-${suffix}.json`)),
        locatorCache: new LocatorCache(scratch(`locators-${suffix}.json`)),
        variableLearning: new VariableLearning(scratch(`variables-${suffix}.json`)),
        statistics: new Statistics(scratch(`statistics-${suffix}.json`)),
        history: new History(scratch(`history-${suffix}.json`)),
        brain: new Brain({ siteKnowledge: { get: () => null, save: () => {} } })
    };

}

test("agent drives a real page from goal to completion", async t => {

    const file = scratch("login.html");

    fs.writeFileSync(file, PAGE);

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

    const planner = scriptedPlanner();

    const agent = new Agent({

        browser,
        planner,
        maxSteps: 6,

        // Keep learning artefacts out of the real memory files.
        elementMemory: new ElementMemory(scratch("elements.json")),
        workflowMemory: new WorkflowMemory(scratch("workflows.json")),
        siteMemory: new SiteMemory(scratch("sites.json")),
        locatorCache: new LocatorCache(scratch("locators.json")),
        variableLearning: new VariableLearning(scratch("variables.json")),
        statistics: new Statistics(scratch("statistics.json")),
        history: new History(scratch("history.json")),
        brain: new Brain({ siteKnowledge: { get: () => null, save: () => {} } })

    });

    const result = await agent.runJob({

        url: `file://${file.replace(/\\/g, "/")}`,

        task: "Log in to the test page",

        goals: [{ goal: "Log in", done: "Welcome message is visible" }],

        variables: { USERNAME: "bob", PASSWORD: "hunter2" }

    });

    assert.equal(result.ok, true, "job succeeded");
    assert.equal(result.goals.length, 1);
    assert.equal(result.goals[0].ok, true);
    assert.ok(planner.calls >= 2, "planner ran again after the page changed");

});

test("agent gives up cleanly when a goal cannot be reached", async t => {

    const file = scratch("login-fail.html");

    fs.writeFileSync(file, PAGE);

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

    const planner = scriptedPlanner();

    const agent = new Agent({

        browser,
        planner,
        maxSteps: 4,

        elementMemory: new ElementMemory(scratch("elements-2.json")),
        workflowMemory: new WorkflowMemory(scratch("workflows-2.json")),
        siteMemory: new SiteMemory(scratch("sites-2.json")),
        locatorCache: new LocatorCache(scratch("locators-2.json")),
        variableLearning: new VariableLearning(scratch("variables-2.json")),
        statistics: new Statistics(scratch("statistics-2.json")),
        history: new History(scratch("history-2.json")),
        brain: new Brain({ siteKnowledge: { get: () => null, save: () => {} } })

    });

    const result = await agent.runJob({

        url: `file://${file.replace(/\\/g, "/")}`,

        task: "Log in to the test page",

        goals: [{ goal: "Log in", done: "Welcome message is visible" }],

        // Wrong password: the page never reaches the Welcome state.
        variables: { USERNAME: "bob", PASSWORD: "wrong" }

    });

    assert.equal(result.ok, false, "job reports failure instead of hanging");
    assert.ok(result.steps <= 4, "step limit respected");

});

test("a failed start URL closes the browser instead of hanging the process", async t => {

    const browser = new Browser({ headless: true, slowMo: 0 });

    try {
        await browser.start();
    }
    catch (error) {
        t.skip(`Playwright browser unavailable: ${error.message}`);
        return;
    }

    t.after(() => browser.close());

    const agent = new Agent({
        browser,
        planner: { plan: async () => { throw new Error("unreachable"); }, record() {}, forget() {} },
        maxSteps: 1,
        ...isolatedMemory("badurl")
    });

    await assert.rejects(
        () => agent.runJob({
            url: "http://127.0.0.1:1/nothing-listens-here",
            task: "Load a dead host",
            goals: [{ goal: "Load the page" }]
        })
    );

    // browser.close() nulls the page: proof the finally ran on the way out.
    assert.equal(browser.page, null, "browser was closed by runJob");

});

test("agent refuses an unearned completion claim and keeps working", async t => {

    const file = scratch("login-liar.html");

    fs.writeFileSync(file, PAGE);

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

    // Claims success before doing anything, then actually logs in.
    const liar = {

        calls: 0,
        sawFeedback: false,

        async plan(context) {

            liar.calls++;

            if (context.feedback) {
                liar.sawFeedback = true;
            }

            if (liar.calls === 1 || /Welcome/.test(context.page.text)) {

                return {
                    actions: [{ action: "finish", value: "done" }],
                    signature: "s",
                    source: "test"
                };

            }

            const find = predicate => context.page.elements.find(predicate);

            return {
                actions: [
                    { action: "fill", source: "USERNAME", element: find(e => e.name === "username") },
                    { action: "fill", source: "PASSWORD", element: find(e => e.name === "password") },
                    { action: "click", element: find(e => e.role === "button") }
                ],
                signature: "s",
                source: "test"
            };

        },

        record() {},
        forget() {}

    };

    const agent = new Agent({
        browser,
        planner: liar,
        maxSteps: 6,
        ...isolatedMemory("liar")
    });

    const result = await agent.runJob({
        url: `file://${file.replace(/\\/g, "/")}`,
        task: "Log in to the test page",
        goals: [{ goal: "Log in", done: "Welcome message is visible" }],
        variables: { USERNAME: "bob", PASSWORD: "hunter2" }
    });

    assert.equal(liar.calls, 3, "the false claim was rejected and re-planned");
    assert.equal(liar.sawFeedback, true, "the planner was told why it was rejected");
    assert.equal(result.ok, true, "the goal completed once it was actually true");

});

test("agent falls back to vision when the DOM has no elements", async t => {

    const file = scratch("canvas.html");

    fs.writeFileSync(file, CANVAS_PAGE);

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

    const vision = {

        calls: 0,

        async plan(context) {

            vision.calls++;

            assert.equal(context.page.elements.length, 0, "vision saw a bare page");

            if (vision.calls === 1) {

                return {
                    actions: [{ action: "clickAt", x: 120, y: 90, value: "canvas" }],
                    source: "vision"
                };

            }

            return {
                actions: [{ action: "finish", value: "canvas clicked" }],
                source: "vision"
            };

        },

        record() {},
        forget() {}

    };

    // Any call to the DOM planner is a wiring bug, not a fallback.
    const domPlanner = {
        plan: async () => { throw new Error("DOM planner should not run on a bare page"); },
        record() {},
        forget() {}
    };

    const agent = new Agent({
        browser,
        planner: domPlanner,
        visionPlanner: vision,
        maxSteps: 4,
        keepOpen: true,
        ...isolatedMemory("vision")
    });

    // keepOpen: this test inspects the page after the job, so it owns the
    // browser. Cleanup is the t.after above, not a finally down here.
    const result = await agent.runJob({
        url: `file://${file.replace(/\\/g, "/")}`,
        task: "Click the canvas",
        goals: [{ goal: "Click the canvas", done: "Title says clicked" }]
    });

    assert.equal(result.ok, true, "goal completed through vision");
    assert.equal(vision.calls, 2);
    assert.equal(await browser.page.title(), "clicked", "the coordinate click landed");

});
