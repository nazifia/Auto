const { test } = require("node:test");
const assert = require("node:assert");

const Queue = require("../src/queue");

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Records overlap: a task that starts while another with the same key runs.
function tracker() {

    const active = new Set();
    const clashes = [];

    let peak = 0;

    return {

        clashes,

        get peak() {
            return peak;
        },

        task(key, ms = 20) {

            return async () => {

                if (active.has(key)) {
                    clashes.push(key);
                }

                active.add(key);

                peak = Math.max(peak, active.size);

                await wait(ms);

                active.delete(key);

                return key;

            };

        }

    };
}

test("runs different keys in parallel, same key in series", async () => {

    const seen = tracker();
    const queue = new Queue({ concurrency: 3 });

    const results = await Promise.all([
        queue.push("a.com", seen.task("a.com")),
        queue.push("a.com", seen.task("a.com")),
        queue.push("b.com", seen.task("b.com")),
        queue.push("c.com", seen.task("c.com"))
    ]);

    assert.deepEqual(results, ["a.com", "a.com", "b.com", "c.com"]);
    assert.deepEqual(seen.clashes, [], "two jobs on one host overlapped");
    assert.equal(seen.peak, 3, "different hosts did not run in parallel");

});

test("never exceeds concurrency", async () => {

    const seen = tracker();
    const queue = new Queue({ concurrency: 2 });

    await Promise.all(
        ["a", "b", "c", "d", "e"].map(key => queue.push(key, seen.task(key, 10)))
    );

    assert.equal(seen.peak, 2);
    assert.equal(queue.running, 0);
    assert.equal(queue.queued, 0);

});

test("a busy key does not block other work", async () => {

    const order = [];
    const queue = new Queue({ concurrency: 2 });

    const runs = [
        queue.push("a", async () => { await wait(30); order.push("a1"); }),
        queue.push("a", async () => { order.push("a2"); }),
        queue.push("b", async () => { order.push("b"); })
    ];

    await Promise.all(runs);

    // b jumped the blocked second "a" instead of waiting behind it.
    assert.deepEqual(order, ["b", "a1", "a2"]);

});

test("rejects once the backlog is full", async () => {

    const queue = new Queue({ concurrency: 1, maxPending: 2 });

    const runs = [
        queue.push("a", () => wait(20)),
        queue.push("b", () => wait(20)),
        queue.push("c", () => wait(20))
    ];

    await assert.rejects(() => queue.push("d", () => wait(20)), /Queue is full/);

    await Promise.all(runs);

});

test("a failing task frees its slot and its key", async () => {

    const queue = new Queue({ concurrency: 1 });

    await assert.rejects(
        () => queue.push("a", async () => { throw new Error("boom"); }),
        /boom/
    );

    assert.equal(await queue.push("a", async () => "next"), "next");
    assert.equal(queue.running, 0);

});
