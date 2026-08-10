const fs = require("fs");
const path = require("path");

class SiteKnowledge {

    constructor() {

        this.directory = path.join(
            __dirname,
            "sites"
        );

        if (!fs.existsSync(this.directory)) {

            fs.mkdirSync(this.directory, {

                recursive: true

            });

        }

    }

    get(url) {

        try {

            const hostname = new URL(url).hostname;

            const file = path.join(

                this.directory,

                hostname + ".json"

            );

            if (!fs.existsSync(file)) {

                return null;

            }

            return JSON.parse(

                fs.readFileSync(

                    file,

                    "utf8"

                )

            );

        }

        catch {

            return null;

        }

    }

    save(url, knowledge) {

        try {

            const hostname = new URL(url).hostname;

            const file = path.join(

                this.directory,

                hostname + ".json"

            );

            fs.writeFileSync(

                file,

                JSON.stringify(

                    knowledge,

                    null,

                    4

                )

            );

            console.log(

                "\n✓ Learned",

                hostname

            );

        }

        catch (error) {

            console.log(

                "Unable to save knowledge",

                error.message

            );

        }

    }

}

module.exports = SiteKnowledge;