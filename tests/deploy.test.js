const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { bodyOf } = require("../scripts/deploy-flow");

// The API 400s on extra fields, so dropping them is the whole job of bodyOf.
test("bodyOf keeps only the four fields the n8n API accepts", () => {

    const body = bodyOf({
        id: "browserAgentRunJob",
        name: "Browser Agent — run job",
        active: true,
        pinData: {},
        nodes: [{ name: "Webhook trigger" }],
        connections: { "Webhook trigger": {} }
    });

    assert.deepStrictEqual(Object.keys(body).sort(), ["connections", "name", "nodes", "settings"]);
    assert.deepStrictEqual(body.settings, {});

});

// The sheet-to-jobs mapping is real logic that lives inside a workflow JSON,
// where nothing else would ever run it. Pull it out and run it here instead of
// finding out from a browser run at 07:00.
function rowsToJobs(rows) {

    const flow = JSON.parse(fs.readFileSync(
        path.join(__dirname, "..", "n8n", "sheets-jobs.json"), "utf8"
    ));

    const code = flow.nodes.find(node => node.name === "Rows to jobs").parameters.jsCode;

    const input = { all: () => rows.map(json => ({ json })) };

    return new Function("$input", "$execution", code)(
        input,
        { resumeUrl: "http://n8n/webhook-waiting/1" }
    )[0].json;

}

test("Rows to jobs turns sheet rows into a jobs batch", () => {

    const out = rowsToJobs([
        {
            "URL": "https://example.com/login",
            "User Name": "alice",
            "Password Ref": "PA_PASSWORD",
            "TAB": "Web",
            "BUTTON": "Run until"
        },
        { url: "https://example.com/login", username: "bob", password: "plain", enabled: "no" },
        { URL: "", USERNAME: "carol", PASSWORD: "plain" }
    ]);

    assert.equal(out.callbackUrl, "http://n8n/webhook-waiting/1");
    assert.equal(out.jobs.length, 1);
    assert.equal(out.jobs[0].name, "alice");
    assert.equal(out.jobs[0].session, false);
    assert.equal(out.jobs[0].goals.length, 3);

    // The password_ref column carries an env key name, so what leaves n8n is
    // the template, never the secret.
    assert.equal(out.jobs[0].variables.PASSWORD, "${PA_PASSWORD}");

});

test("Rows to jobs refuses rows it cannot log in with", () => {

    assert.throws(
        () => rowsToJobs([{ URL: "https://example.com", USERNAME: "alice" }]),
        /No password for: alice/
    );

    assert.throws(() => rowsToJobs([]), /No usable rows/);

});
