const PlanValidator = require("./planning/planValidator");

// Thin facade so the agent loop keeps one obvious name for "check the plan".
class Validator extends PlanValidator {

    validate(plan) {

        return super.validate(Array.isArray(plan) ? plan : [plan]);

    }

}

module.exports = Validator;
