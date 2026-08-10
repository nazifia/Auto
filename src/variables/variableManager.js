class VariableManager {

    constructor(variables = {}) {

        this.variables = {};

        // Store every variable using uppercase keys
        for (const [key, value] of Object.entries(variables)) {

            this.variables[key.toUpperCase()] = value;

        }

    }

    has(name) {

        return Object.prototype.hasOwnProperty.call(

            this.variables,

            name.toUpperCase()

        );

    }

    get(name) {

        return this.variables[name.toUpperCase()];

    }

    set(name, value) {

        this.variables[name.toUpperCase()] = value;

    }

    remove(name) {

        delete this.variables[name.toUpperCase()];

    }

    all() {

        return this.variables;

    }

}

module.exports = VariableManager;