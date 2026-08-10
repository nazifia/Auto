const { normalize } = require("../utils/fingerprint");

const LOGGED_IN = ["log out", "logout", "sign out", "dashboard", "my account"];
const LOGGED_OUT = ["log in", "login", "sign in"];

// Derived facts about the current page. Site-agnostic on purpose: the first
// version hardcoded one site's markup, which made it useless anywhere else.
class State {

    constructor() {

        this.data = {
            url: "",
            currentPage: "",
            visitedUrls: [],
            filledFields: [],
            emptyRequiredFields: [],
            loggedIn: false,
            hasForm: false
        };

    }

    update(page) {

        const elements = page.elements || [];

        const texts = elements.map(element => normalize(element.text)).filter(Boolean);

        this.data.url = page.url;
        this.data.currentPage = page.title;

        if (this.data.visitedUrls[this.data.visitedUrls.length - 1] !== page.url) {

            this.data.visitedUrls.push(page.url);
            this.data.visitedUrls = this.data.visitedUrls.slice(-15);

        }

        const inputs = elements.filter(element => element.role === "input");

        this.data.hasForm = inputs.length > 0;

        this.data.filledFields = inputs
            .filter(element => element.value)
            .map(element => element.placeholder || element.name || element.id)
            .filter(Boolean);

        this.data.emptyRequiredFields = inputs
            .filter(element => element.required && !element.value)
            .map(element => element.placeholder || element.name || element.id)
            .filter(Boolean);

        const hasAny = list => texts.some(text => list.some(word => text.includes(word)));

        const hasPasswordField = inputs.some(element => element.type === "password");

        // "Log out" present is strong evidence. Otherwise: no login affordance
        // and no password box on a page we navigated to also means logged in.
        this.data.loggedIn = hasAny(LOGGED_IN)
            || (!hasAny(LOGGED_OUT) && !hasPasswordField && this.data.visitedUrls.length > 1);

        return this.data;

    }

    set(key, value) {

        this.data[key] = value;

    }

    get() {

        return this.data;

    }

}

module.exports = State;
