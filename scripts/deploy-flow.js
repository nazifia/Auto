const fs = require("fs");
const path = require("path");

require("dotenv").config({
    path: path.join(__dirname, "..", ".env")
});

// Push a workflow JSON straight into a running n8n:
//
//   npm run deploy:flow n8n/browser-agent.json
//
// Beats `docker cp` + `n8n import:workflow` + container restart: the REST API
// registers the webhook itself. Needs N8N_API_KEY (n8n: Settings > n8n API).

const base = (process.env.N8N_URL || "http://127.0.0.1:5678").replace(/\/+$/, "");

async function api(method, route, body) {

    const response = await fetch(`${base}/api/v1${route}`, {
        method,
        headers: {
            "content-type": "application/json",
            "X-N8N-API-KEY": process.env.N8N_API_KEY
        },
        body: body ? JSON.stringify(body) : undefined
    });

    const text = await response.text();

    if (!response.ok) {
        throw new Error(`${method} ${route} → ${response.status} ${text}`);
    }

    return text ? JSON.parse(text) : {};

}

// The REST API rejects any field outside these four ("must NOT have additional
// properties"). id, active and pinData live in the file for `import:workflow`,
// which is a different door into the same building.
function bodyOf(flow) {

    return {
        name: flow.name,
        nodes: flow.nodes,
        connections: flow.connections,
        settings: flow.settings || {}
    };

}

async function deploy(file) {

    if (!process.env.N8N_API_KEY) {
        throw new Error("N8N_API_KEY is not set in .env (n8n: Settings > n8n API).");
    }

    const flow = JSON.parse(fs.readFileSync(file, "utf8"));

    if (!flow.name || !Array.isArray(flow.nodes)) {
        throw new Error(`${file} has no 'name' or 'nodes' — not a workflow export.`);
    }

    // Matching on name, not id: an id from a file exported elsewhere means
    // nothing here. ponytail: first 250 workflows only, paginate if that fills.
    const listed = await api("GET", "/workflows?limit=250");

    const existing = (listed.data || []).find(workflow => workflow.name === flow.name);

    const saved = existing
        ? await api("PUT", `/workflows/${existing.id}`, bodyOf(flow))
        : await api("POST", "/workflows", bodyOf(flow));

    // PUT drops the active flag, so activation is always a separate call.
    if (flow.active !== false) {
        await api("POST", `/workflows/${saved.id}/activate`);
    }

    console.log(`${existing ? "Updated" : "Created"} "${saved.name}" (${saved.id}) on ${base}`);

    const hook = flow.nodes.find(node => node.type === "n8n-nodes-base.webhook");

    if (hook && hook.parameters && hook.parameters.path) {
        console.log(`Fire it: curl -X POST ${base}/webhook/${hook.parameters.path}`);
    }

    return saved;

}

if (require.main === module) {

    const file = process.argv[2];

    if (!file) {

        console.error("Usage: node scripts/deploy-flow.js <workflow.json>");

        process.exit(1);

    }

    deploy(file).catch(error => {

        console.error(error.message);

        process.exit(1);

    });

}

module.exports = { deploy, bodyOf };
