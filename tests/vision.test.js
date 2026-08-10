const { test } = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");

const ImageAnalyzer = require("../src/vision/imageAnalyzer");
const VisionPlanner = require("../src/vision/visionPlanner");
const Ocr = require("../src/vision/ocr");
const PlanValidator = require("../src/planning/planValidator");
const Executor = require("../src/executor");
const LocatorCache = require("../src/cache/locatorCache");
const VariableResolver = require("../src/variables/variableResolver");

const SHOT = {
    buffer: Buffer.from("fake-png"),
    dataUrl: `data:image/png;base64,${Buffer.from("fake-png").toString("base64")}`,
    width: 800,
    height: 600
};

const PAGE = {
    url: "https://example.com/app",
    host: "example.com",
    title: "App",
    text: "",
    elements: [
        {
            elementId: 1,
            fingerprint: "input|name:search",
            role: "input",
            text: "",
            placeholder: "Search",
            locators: [{ type: "name", value: "search" }]
        }
    ]
};

const fakeObserver = { observe: async () => SHOT };

function fakeAi(reply) {

    const ai = {
        messages: null,
        options: null,
        chat: async (messages, options) => {
            ai.messages = messages;
            ai.options = options;
            return reply;
        }
    };

    return ai;

}

test("imageAnalyzer sends the screenshot as a multimodal message", async () => {

    const ai = fakeAi(JSON.stringify({ ok: true }));

    const analyzer = new ImageAnalyzer({ ai, model: "some/vision-model" });

    const result = await analyzer.analyze(SHOT.buffer, "What is this?");

    assert.deepEqual(result, { ok: true });

    const content = ai.messages[0].content;

    assert.equal(content[0].type, "text");
    assert.equal(content[1].type, "image_url");
    assert.ok(content[1].image_url.url.startsWith("data:image/png;base64,"));
    assert.equal(ai.options.model, "some/vision-model");

});

test("imageAnalyzer.describe asks for plain text, not JSON", async () => {

    const ai = fakeAi("A login screen.");

    const analyzer = new ImageAnalyzer({ ai });

    assert.equal(await analyzer.describe(SHOT), "A login screen.");
    assert.equal(ai.options.json, false);

});

test("imageAnalyzer rejects a non-image argument", () => {

    assert.throws(() => ImageAnalyzer.dataUrl(42), /Buffer, base64 string, or screenshot/);

});

test("visionPlanner resolves elementIds and keeps coordinate clicks", async () => {

    const planner = new VisionPlanner({
        ai: fakeAi(JSON.stringify({
            reason: "search box is visible",
            actions: [
                { action: "click", elementId: 1 },
                { action: "clickAt", x: 400, y: 300, value: "canvas toolbar" },
                { action: "type", value: "hello" }
            ]
        })),
        screenshotObserver: fakeObserver
    });

    const result = await planner.plan({ goal: "Search", page: PAGE, variables: [] });

    assert.equal(result.source, "vision");
    assert.equal(result.actions.length, 3);
    assert.equal(result.actions[0].element.fingerprint, "input|name:search");
    assert.deepEqual(
        [result.actions[1].x, result.actions[1].y],
        [400, 300]
    );

});

test("visionPlanner refuses a click outside the viewport", async () => {

    const planner = new VisionPlanner({
        ai: fakeAi(JSON.stringify({
            actions: [{ action: "clickAt", x: 9000, y: 12 }]
        })),
        screenshotObserver: fakeObserver
    });

    await assert.rejects(
        () => planner.plan({ goal: "Click", page: PAGE, variables: [] }),
        /outside the 800x600 viewport/
    );

});

test("visionPlanner caps the batch at three actions", async () => {

    const planner = new VisionPlanner({
        ai: fakeAi(JSON.stringify({
            actions: [
                { action: "wait", ms: 1 },
                { action: "wait", ms: 2 },
                { action: "wait", ms: 3 },
                { action: "wait", ms: 4 }
            ]
        })),
        screenshotObserver: fakeObserver
    });

    const result = await planner.plan({ goal: "Wait", page: PAGE, variables: [] });

    assert.equal(result.actions.length, 3);

});

test("planValidator accepts vision actions and catches broken ones", () => {

    const validator = new PlanValidator();

    assert.ok(validator.validate([{ action: "clickAt", x: 10, y: 20 }]));
    assert.ok(validator.validate([{ action: "type", value: "hi" }]));
    assert.ok(validator.validate([{ action: "press", key: "Enter" }]));

    assert.throws(() => validator.validate([{ action: "clickAt", x: 10 }]), /numeric 'x' and 'y'/);
    assert.throws(() => validator.validate([{ action: "type" }]), /needs 'source' or 'value'/);

});

test("ocr reads text through the vision model, no OCR dependency", async () => {

    const analyzer = new ImageAnalyzer({ ai: fakeAi("Username\nPassword\nLog in") });

    const ocr = new Ocr(analyzer);

    assert.equal(await ocr.contains(SHOT, "log in"), true);
    assert.equal(await ocr.contains(SHOT, "sign out"), false);

});

test("ocr.locate returns coordinates, or null when not found", async () => {

    const found = new Ocr(new ImageAnalyzer({
        ai: fakeAi(JSON.stringify({ found: true, text: "Run", x: 120, y: 340 }))
    }));

    assert.deepEqual(
        await found.locate(SHOT, "the Run button"),
        { found: true, text: "Run", x: 120, y: 340 }
    );

    const missing = new Ocr(new ImageAnalyzer({
        ai: fakeAi(JSON.stringify({ found: false, reason: "not visible" }))
    }));

    assert.equal(await missing.locate(SHOT, "the Run button"), null);

});

test("executor performs clickAt and type", async () => {

    const calls = [];

    const browser = {
        page: {
            url: () => "https://example.com/app",
            mouse: { click: async (x, y) => calls.push(["clickAt", x, y]) },
            keyboard: { type: async text => calls.push(["type", text]) }
        }
    };

    const executor = new Executor(
        browser,
        VariableResolver.fromJob({ USERNAME: "bob" }),
        {
            resolver: { resolve: async () => null },
            watcher: { settle: async () => {} },
            locatorCache: new LocatorCache(
                path.join(os.tmpdir(), `agent-test-vision-${Date.now()}.json`)
            )
        }
    );

    await executor.execute({ action: "clickAt", x: 400, y: 300 });
    await executor.execute({ action: "type", source: "USERNAME" });

    assert.deepEqual(calls, [["clickAt", 400, 300], ["type", "bob"]]);

});
