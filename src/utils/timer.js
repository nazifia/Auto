const logger = require("./logger");

function timer(label) {

    const start = Date.now();

    return {

        ms: () => Date.now() - start,

        done() {

            const ms = Date.now() - start;

            if (label) {
                logger.debug(`⏱ ${label}: ${ms}ms`);
            }

            return ms;

        }

    };

}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = { timer, sleep };
