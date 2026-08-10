const fs = require("fs");
const path = require("path");

class PlanCache {

    constructor() {

        this.directory = path.join(__dirname, "plans");

        if (!fs.existsSync(this.directory)) {

            fs.mkdirSync(this.directory, {

                recursive: true

            });

        }

    }

    filename(task) {

        return path.join(

            this.directory,

            Buffer
                .from(task)
                .toString("base64")
                .replace(/[\/+=]/g, "_") + ".json"

        );

    }

    get(task) {

        const file = this.filename(task);

        if (!fs.existsSync(file)) {

            return null;

        }

        console.log("\n✓ Loaded execution plan from cache.");

        return JSON.parse(

            fs.readFileSync(file, "utf8")

        );

    }

    save(task, plan) {

        fs.writeFileSync(

            this.filename(task),

            JSON.stringify(

                plan,

                null,

                4

            )

        );

        console.log("\n✓ Execution plan cached.");

    }

}

module.exports = PlanCache;