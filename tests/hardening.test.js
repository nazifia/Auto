const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PlanValidator = require("../src/planning/planValidator");
const VariableResolver = require("../src/variables/variableResolver");
const { readJson, writeJson } = require("../src/utils/json");
const JobLoader = require("../src/jobLoader");
const OpenRouter = require("../src/ai/openrouter");
const { callbackFrom } = require("../src/server");

const scratch = name => path.join(os.tmpdir(), `agent-hardening-${process.pid}-${name}`);

test("a planned variable must be one the job declared, not any env var", () => {

    process.env.HARDENING_FAKE_SECRET = "sk-should-never-be-typed";

    const variables = VariableResolver.fromJob({ USERNAME: "bob" });

    assert.equal(variables.get("USERNAME"), "bob");

    // A hostile page steering the planner into naming an env var as the source
    // of a fill must not be able to have the agent type it into a form.
    assert.equal(variables.get("HARDENING_FAKE_SECRET"), undefined);

    assert.throws(
        () => variables.resolveValue({ action: "fill", source: "HARDENING_FAKE_SECRET" }),
        /Unknown variable/
    );

    delete process.env.HARDENING_FAKE_SECRET;

});

test("goto is limited to http(s)", () => {

    const validator = new PlanValidator();

    assert.ok(validator.validate([{ action: "goto", url: "https://example.com" }]));

    for (const url of ["file:///C:/Users/Dell/Desktop/N8N/Automation/.env", "javascript:alert(1)"]) {

        assert.throws(
            () => validator.validate([{ action: "goto", url }]),
            /goto must be http/,
            url
        );

    }

});

test("writeJson never leaves a half-written file behind", () => {

    const file = scratch("atomic.json");

    writeJson(file, { learned: 1 });

    // The temp file is the crash-safety mechanism: it must not survive the write.
    const leftovers = fs.readdirSync(path.dirname(file))
        .filter(name => name.startsWith(path.basename(file)) && name.endsWith(".tmp"));

    assert.deepEqual(leftovers, []);

    assert.deepEqual(readJson(file, null), { learned: 1 });

    writeJson(file, { learned: 2 });

    assert.deepEqual(readJson(file, null), { learned: 2 }, "rename overwrites in place");

    fs.rmSync(file, { force: true });

});

test("a callback URL is checked before a browser run is spent on it", () => {

    assert.equal(
        callbackFrom({ callbackUrl: "http://host.docker.internal:5678/webhook/x" }, []),
        "http://host.docker.internal:5678/webhook/x"
    );

    assert.equal(callbackFrom({}, []), null, "no callback is the sync-reply case");

    assert.throws(() => callbackFrom({ callbackUrl: "not a url" }, []), /not a valid URL/);

    assert.throws(
        () => callbackFrom({ callbackUrl: "file:///C:/Windows/win.ini" }, []),
        /must be http/
    );

    // With an allowlist, /run can only be pointed at n8n, not at anything else
    // the agent host happens to be able to reach.
    assert.throws(
        () => callbackFrom({ callbackUrl: "http://169.254.169.254/latest/meta-data" }, ["n8n.local"]),
        /host is not allowed/
    );

});

test("only hiccups are retried, not verdicts", () => {

    const status = code => Object.assign(new Error(`AI ${code}`), { status: code });

    assert.equal(OpenRouter.retryable(status(500)), true);
    assert.equal(OpenRouter.retryable(status(429)), true);
    assert.equal(OpenRouter.retryable(status(408)), true);

    // A bad key answers the same way every time; three tries just delays it.
    assert.equal(OpenRouter.retryable(status(401)), false);
    assert.equal(OpenRouter.retryable(status(400)), false);

    // No status at all means the request never landed — worth another go.
    assert.equal(OpenRouter.retryable(new Error("fetch failed")), true);

});

test("an http job source that never answers fails instead of hanging", async () => {

    const loader = new JobLoader({
        source: "http",
        // Reserved-for-documentation address: connects to nothing, never resets.
        url: "http://192.0.2.1:9/jobs",
        timeout: 200
    });

    await assert.rejects(() => loader.load());

});
