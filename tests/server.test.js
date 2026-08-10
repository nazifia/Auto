const { test } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");

const { start } = require("../src/server");

const TOKEN = "secret-token";

const JOB = { url: "https://example.com", task: "do a thing" };

// Stands in for the real Agent — this test is about the HTTP seam, not chromium.
const fakeAgent = {
    runJob: async job => ({ ok: true, goals: [], steps: 1, task: job.task })
};

function listen(server) {

    return new Promise(resolve => {

        if (server.listening) {
            return resolve(server.address().port);
        }

        server.once("listening", () => resolve(server.address().port));

    });
}

async function post(port, body, token = TOKEN) {

    const response = await fetch(`http://127.0.0.1:${port}/run`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            ...(token ? { "x-auth-token": token } : {})
        },
        body: JSON.stringify(body)
    });

    return { status: response.status, body: await response.json() };

}

test("runs a job posted by n8n and returns the result", async () => {

    const server = start({ port: 0, token: TOKEN, agent: fakeAgent });
    const port = await listen(server);

    try {

        const missing = await post(port, { url: "https://example.com" });

        assert.equal(missing.status, 400);
        assert.match(missing.body.error, /task/);

        const unauthorized = await post(port, JOB, null);

        assert.equal(unauthorized.status, 401);

        const ok = await post(port, JOB);

        assert.equal(ok.status, 200);
        assert.equal(ok.body.ok, true);
        assert.equal(ok.body.results[0].task, JOB.task);

    }
    finally {
        server.close();
    }

});

test("callback mode replies immediately and posts the result back", async () => {

    let delivered = null;

    const n8n = http.createServer((req, res) => {

        const chunks = [];

        req.on("data", chunk => chunks.push(chunk));

        req.on("end", () => {

            delivered = JSON.parse(Buffer.concat(chunks).toString("utf8"));

            res.writeHead(200).end("{}");

        });

    });

    n8n.listen(0, "127.0.0.1");

    const hookPort = await listen(n8n);

    const server = start({ port: 0, token: TOKEN, agent: fakeAgent });
    const port = await listen(server);

    try {

        const accepted = await post(port, {
            ...JOB,
            callbackUrl: `http://127.0.0.1:${hookPort}/webhook`
        });

        assert.equal(accepted.status, 202);
        assert.equal(accepted.body.status, "running");
        assert.ok(accepted.body.id);

        for (let waited = 0; !delivered && waited < 5000; waited += 50) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        assert.ok(delivered, "callback was never delivered");
        assert.equal(delivered.ok, true);

        const status = await fetch(`http://127.0.0.1:${port}/runs/${accepted.body.id}`, {
            headers: { "x-auth-token": TOKEN }
        });

        assert.equal((await status.json()).status, "done");

    }
    finally {

        server.close();
        n8n.close();

    }

});

test("retries a callback that is not ready yet", async () => {

    let hits = 0;
    let delivered = null;

    // First call 404s, exactly like n8n before its Wait node parks.
    const flaky = http.createServer((req, res) => {

        hits++;

        if (hits === 1) {
            return res.writeHead(404).end();
        }

        const chunks = [];

        req.on("data", chunk => chunks.push(chunk));

        req.on("end", () => {

            delivered = JSON.parse(Buffer.concat(chunks).toString("utf8"));

            res.writeHead(200).end("{}");

        });

    });

    flaky.listen(0, "127.0.0.1");

    const hookPort = await listen(flaky);

    const server = start({ port: 0, token: TOKEN, agent: fakeAgent });
    const port = await listen(server);

    try {

        await post(port, { ...JOB, callbackUrl: `http://127.0.0.1:${hookPort}/waiting` });

        for (let waited = 0; !delivered && waited < 10000; waited += 100) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        assert.ok(delivered, "callback was never retried");
        assert.equal(hits, 2);
        assert.equal(delivered.ok, true);

    }
    finally {

        server.close();
        flaky.close();

    }

});

test("runs jobs on different hosts in parallel, same host in series", async () => {

    const active = new Set();
    const clashes = [];

    let peak = 0;

    const slowAgent = {

        runJob: async job => {

            const host = new URL(job.url).hostname;

            if (active.has(host)) {
                clashes.push(host);
            }

            active.add(host);

            peak = Math.max(peak, active.size);

            await new Promise(resolve => setTimeout(resolve, 30));

            active.delete(host);

            return { ok: true, steps: 1, task: job.task };

        }

    };

    const server = start({ port: 0, token: TOKEN, agent: slowAgent, concurrency: 3 });
    const port = await listen(server);

    try {

        const response = await post(port, {
            jobs: [
                { url: "https://a.example", task: "one" },
                { url: "https://a.example", task: "two" },
                { url: "https://b.example", task: "three" },
                { url: "https://c.example", task: "four" }
            ]
        });

        assert.equal(response.status, 200);
        assert.deepEqual(clashes, [], "two jobs hit the same host at once");
        assert.equal(peak, 3, "hosts did not run in parallel");

        // Results stay in request order regardless of finish order.
        assert.deepEqual(
            response.body.results.map(result => result.task),
            ["one", "two", "three", "four"]
        );

    }
    finally {
        server.close();
    }

});

test("rejects with 429 once the backlog is full", async () => {

    const stall = { runJob: () => new Promise(resolve => setTimeout(() => resolve({ ok: true }), 60)) };

    const server = start({
        port: 0,
        token: TOKEN,
        agent: stall,
        concurrency: 1,
        maxQueue: 1
    });

    const port = await listen(server);

    try {

        const running = post(port, { ...JOB, callbackUrl: null });
        const waiting = post(port, { url: "https://b.example", task: "queued" });

        // Give both requests time to reach the queue before overflowing it.
        await new Promise(resolve => setTimeout(resolve, 20));

        const rejected = await post(port, { url: "https://c.example", task: "too much" });

        assert.equal(rejected.status, 429);

        await Promise.all([running, waiting]);

    }
    finally {
        server.close();
    }

});

test("refuses to bind publicly without a token", () => {

    assert.throws(
        () => start({ port: 0, host: "0.0.0.0", token: undefined }),
        /AGENT_TOKEN/
    );

});
