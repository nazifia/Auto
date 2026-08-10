const fs = require("fs");
const path = require("path");

const config = require("./config");
const logger = require("./utils/logger");

const JobLoader = require("./jobLoader");
const TaskPlanner = require("./taskPlanner");
const GoalManager = require("./goalManager");

const Browser = require("./browser");
const Observer = require("./observer");
const Ranker = require("./ranker");
const Brain = require("./brain");
const Planner = require("./planner");
const Validator = require("./validator");
const Executor = require("./executor");
const RecoveryManager = require("./recoveryManager");

const ExecutionGraph = require("./planning/executionGraph");
const ConditionalPlanner = require("./planning/conditionalPlanner");
const GoalVerifier = require("./planning/goalVerifier");
const plugins = require("./plugins");

const History = require("./memory/history");
const State = require("./memory/state");
const ElementMemory = require("./memory/elementMemory");
const WorkflowMemory = require("./memory/workflowMemory");

const SiteMemory = require("./knowledge/siteMemory");
const ConfidenceModel = require("./knowledge/confidenceModel");

const LocatorCache = require("./cache/locatorCache");
const ActionCache = require("./cache/actionCache");

const VariableResolver = require("./variables/variableResolver");
const VariableLearning = require("./variables/variableLearning");

const Learner = require("./learning/learner");
const Screenshot = require("./browser/screenshot");
const VisionPlanner = require("./vision/visionPlanner");

class Agent {

    constructor(options = {}) {

        this.options = options;

        this.elementMemory = options.elementMemory || new ElementMemory();
        this.confidenceModel = new ConfidenceModel(this.elementMemory);
        this.workflowMemory = options.workflowMemory || new WorkflowMemory();
        this.siteMemory = options.siteMemory || new SiteMemory();
        this.locatorCache = options.locatorCache || new LocatorCache();
        this.variableLearning = options.variableLearning || new VariableLearning();

        // Both of these construct an LLM client, so they stay lazy: a job that
        // supplies its own goals and planner must run without an API key.
        this._taskPlanner = options.taskPlanner || null;
        this._planner = options.planner || null;

        this.brain = options.brain || new Brain({
            variableLearning: this.variableLearning,
            workflowMemory: this.workflowMemory
        });

        this.validator = options.validator || new Validator();
        this.conditional = new ConditionalPlanner();

        this.maxSteps = options.maxSteps ?? config.agent.maxSteps;

        // Vision is a fallback, not the main path: it runs when the DOM gives
        // the planner nothing to work with, or when the DOM planner is stuck.
        this.visionEnabled = Boolean(
            options.visionPlanner || (options.vision ?? config.vision.enabled)
        );

    }

    get taskPlanner() {

        this._taskPlanner = this._taskPlanner
            || new TaskPlanner({ ai: this.options.ai });

        return this._taskPlanner;

    }

    get planner() {

        this._planner = this._planner || new Planner({
            ai: this.options.ai,
            elementMemory: this.elementMemory,
            confidenceModel: this.confidenceModel
        });

        return this._planner;

    }

    async runJob(job) {

        JobLoader.validate(job);

        logger.section("JOB");
        logger.info(job.task);

        const variables = VariableResolver.fromJob(job.variables);

        logger.info("Variables:", variables.names().join(", ") || "(none)");

        const plan = job.goals || await this.taskPlanner.createPlan(job.task);

        logger.section("EXECUTION PLAN");
        logger.info(plan.map((step, index) => `${index + 1}. ${step.goal}`).join("\n"));

        const goals = new GoalManager(plan);

        // Session reuse skips the login goal entirely on later runs. Opt-in per
        // job: storageState holds cookies, which are credentials on disk.
        const sessionFile = job.session ? this.sessionFile(job.url) : null;

        const restored = Boolean(sessionFile && fs.existsSync(sessionFile));

        const browser = this.options.browser || new Browser({
            ...job.browser,
            storageState: restored ? sessionFile : undefined
        });

        if (restored) {
            logger.info("Restored saved session.");
        }

        const observer = new Observer(browser);
        const ranker = new Ranker(this.elementMemory, this.confidenceModel);

        // Per run, not per Agent: rejections are keyed by goal text alone, and
        // the server shares one Agent across every job. A shared verifier lets
        // one job's rejected "Log in" force-accept another job's, unverified.
        const verifier = this.options.verifier || new GoalVerifier();
        const state = new State();
        const history = this.options.history || new History();
        const actionCache = new ActionCache();
        const screenshot = new Screenshot(browser);

        const executor = new Executor(browser, variables, {
            locatorCache: this.locatorCache
        });

        const recovery = new RecoveryManager({
            browser,
            planner: this.planner,
            startUrl: job.url,
            maxRetries: config.agent.maxRetries
        });

        const learner = new Learner({
            elementMemory: this.elementMemory,
            variableLearning: this.variableLearning,
            workflowMemory: this.workflowMemory,
            siteMemory: this.siteMemory,
            locatorCache: this.locatorCache,
            statistics: this.options.statistics,
            brain: this.brain
        });

        const vision = this.visionEnabled
            ? (this.options.visionPlanner || new VisionPlanner({ ai: this.options.ai, browser }))
            : null;

        let page = null;
        let steps = 0;
        let visionNext = false;
        let feedback = null;

        try {

            // Inside the try: a failed launch or a bad start URL must still hit
            // the finally, or chromium is left running and the process hangs.
            await browser.start();
            await browser.open(job.url);

            while (!goals.finished() && steps < this.maxSteps) {

                steps++;

                learner.statistics.add("steps");

                const goal = goals.current();

                if (goals.exhausted()) {

                    logger.warn(`Giving up on goal: ${goal}`);

                    goals.abandon("attempt limit reached");

                    continue;

                }

                goals.attempt();

                logger.section(`GOAL ${goals.progress()}: ${goal}`);

                // A plan step can call a non-browser capability instead.
                if (goals.step().plugin) {

                    try {

                        await this.runPluginStep(goals.step(), variables);

                        goals.complete("plugin");

                    }
                    catch (error) {

                        logger.error("Plugin step failed:", error.message);

                        goals.abandon(error.message);

                    }

                    continue;

                }

                page = await this.look(observer, ranker, state, goal);

                this.siteMemory.record(page.host, "visits");

                if (recovery.stuck(goal, page.signature)) {

                    await recovery.handleDeadEnd({
                        host: page.host,
                        goal,
                        signature: page.signature
                    });

                    // The DOM has stopped being useful — look at the screen.
                    visionNext = Boolean(vision);

                    continue;

                }

                const context = this.brain.buildContext({
                    goal,
                    done: goals.done(),
                    task: job.task,
                    page,
                    state: state.get(),
                    history: history.recent(),
                    variables: variables.names(),
                    feedback
                });

                // A rejected completion claim must not be cached as a good plan.
                context.forceFresh = recovery.forceFresh() || Boolean(feedback);

                feedback = null;

                const blind = (page.elements || []).length === 0;

                const useVision = Boolean(vision) && (blind || visionNext);

                visionNext = false;

                let plannedResult;

                try {

                    if (useVision) {
                        logger.info(blind ? "No DOM elements — using vision." : "Using vision.");
                    }

                    plannedResult = useVision
                        ? await vision.plan(context)
                        : await this.planner.plan(context);

                    // Validation failure is a planning failure: recover from it
                    // rather than killing the job.
                    this.validator.validate(plannedResult.actions);

                }
                catch (error) {

                    if (await recovery.handle(error, { host: page.host, goal }) === "abort") {

                        goals.abandon(error.message);

                        recovery.reset();

                    }

                    continue;

                }

                learner.planned(page.host, plannedResult.source);

                const result = await this.runPlan({
                    actions: plannedResult.actions,
                    page,
                    goal,
                    observer,
                    ranker,
                    state,
                    executor,
                    history,
                    learner,
                    actionCache
                });

                page = result.page;

                // Vision plans are not cached, so there is nothing to score.
                if (plannedResult.source !== "vision") {

                    this.planner.record(
                        page.host,
                        goal,
                        plannedResult.signature,
                        !result.error
                    );

                }

                if (result.error) {

                    const decision = await recovery.handle(result.error, {
                        host: page.host,
                        goal,
                        signature: plannedResult.signature,
                        source: plannedResult.source
                    });

                    if (decision === "abort") {

                        if (config.agent.screenshotOnFailure) {
                            await screenshot.take(`failed-${goal}`);
                        }

                        goals.abandon(result.error.message);

                        recovery.reset();

                    }

                    continue;

                }

                recovery.reset();

                if (result.goalComplete) {

                    // "finish" is a claim. Check it against the goal's own
                    // done-hint before believing it.
                    const verdict = verifier.accept(goal, goals.done(), page);

                    if (!verdict.accepted) {

                        logger.warn(`Rejected completion claim: ${verdict.reason}`);

                        feedback = `You reported the goal complete, but the page does not show "${goals.done()}" (${verdict.reason}). Continue working on the goal, or explain in "reason" why it is genuinely done.`;

                        continue;

                    }

                    logger.info(
                        `✓ Goal complete: ${goal}`
                        + (verdict.forced ? " (unverified)" : "")
                    );

                    goals.complete(result.note);

                    learner.goalCompleted(page.host);

                    recovery.progressed(goal);

                }

            }

            if (!goals.finished()) {

                logger.warn(`Step limit (${this.maxSteps}) reached.`);

                while (!goals.finished()) {
                    goals.abandon("step limit reached");
                }

            }

            const ok = goals.succeeded();

            logger.section(ok ? "ALL GOALS COMPLETED" : "FINISHED WITH FAILURES");
            logger.table(goals.summary());

            page = page || await observer.observe();

            learner.jobFinished({
                host: page.host,
                task: job.task,
                actions: history.get(),
                page,
                ok
            });

            history.persist({ task: job.task, url: job.url, ok });

            if (ok && sessionFile) {

                fs.mkdirSync(path.dirname(sessionFile), { recursive: true });

                await browser.saveSession(sessionFile);

                logger.info("Session saved — the next run can skip logging in.");

            }

            // name and url ride along so a batch caller can tell whose result
            // this is — with several jobs in one /run, order is the only other
            // clue and an n8n expression has no clean way to use it.
            return { ok, name: job.name || null, url: job.url, goals: goals.summary(), steps };

        }
        finally {

            if (!this.options.keepOpen) {
                await browser.close();
            }

        }

    }

    sessionFile(url) {

        let host = "default";

        try {
            host = new URL(url).hostname || host;
        }
        catch {
            // Non-URL job target: one shared session file is fine.
        }

        return path.join(__dirname, "memory", "sessions", `${host}.json`);

    }

    // A plan step like { goal, plugin: "api", request: {...}, saveAs: "TOKEN" }.
    async runPluginStep(step, variables) {

        const request = variables.resolveObject(step.request || {});

        const result = await plugins.run(step.plugin, request);

        if (step.saveAs) {

            variables.set(step.saveAs, typeof result === "string"
                ? result
                : JSON.stringify(result));

            logger.info(`Plugin result stored in ${step.saveAs}.`);

        }

        return result;

    }

    // Observe + rank + derive state, in the one order everything else assumes.
    async look(observer, ranker, state, goal) {

        const page = await observer.observe();

        page.elements = ranker.rank(page, { goal });

        page.state = state.update(page);

        return page;

    }

    async runPlan({ actions, page, goal, observer, ranker, state, executor, history, learner, actionCache }) {

        const graph = new ExecutionGraph(actions);

        let goalComplete = false;
        let note = null;
        let error = null;

        for (const step of graph) {

            const action = step.action;

            if (!this.conditional.shouldRun(action, page)) {

                logger.info(`↷ skipped ${action.action} (condition not met)`);

                graph.skip(step, "condition not met");

                continue;

            }

            if (action.action === "finish") {

                graph.done(step);

                goalComplete = true;
                note = action.value || null;

                break;

            }

            // Batched actions can go stale once an earlier one changes the page.
            if (!this.validator.stillValid(action, page)) {

                logger.warn(`Element for ${action.action} is gone — replanning.`);

                graph.skip(step, "element no longer present");

                break;

            }

            if (actionCache.repeated(action, page.signature, 3)) {

                logger.warn(`Skipping repeated action: ${action.action}`);

                graph.skip(step, "repeated with no effect");

                break;

            }

            try {

                await executor.execute(action);

                actionCache.record(action, page.signature);

                graph.done(step);

                history.add({ ...action, goal });

                learner.actionSucceeded(page.host, action);

            }
            catch (failure) {

                graph.fail(step, failure);

                history.add({ ...action, goal, ok: false });

                learner.actionFailed(page.host, action, failure);

                error = failure;

                break;

            }

            await executor.settle();

            page = await this.look(observer, ranker, state, goal);

        }

        logger.debug("Plan:", graph.summary());

        return { page, goalComplete, note, error };

    }

}

async function run(options = {}) {

    const loader = options.jobLoader || new JobLoader(options.jobs ? { jobs: options.jobs } : {});

    const jobs = await loader.all();

    const agent = new Agent(options);

    const results = [];

    for (const job of jobs) {

        try {
            results.push(await agent.runJob(job));
        }
        catch (error) {

            logger.error("JOB FAILED:", error.message);

            results.push({ ok: false, error: error.message });

        }

    }

    return results;

}

if (require.main === module) {

    run()
        .then(results => {

            const failed = results.filter(result => !result.ok).length;

            process.exit(failed > 0 ? 1 : 0);

        })
        .catch(error => {

            logger.error("ERROR:", error);

            process.exit(1);

        });

}

module.exports = { Agent, run };
