class KnowledgeFilter {

    isUseful(action) {

        if (!action.element) {
            return false;
        }

        const text = (action.element.text || "").trim().toLowerCase();

        const placeholder = (action.element.placeholder || "")
            .trim()
            .toLowerCase();

        // -----------------------------
        // Login fields
        // -----------------------------
        if (
            placeholder.includes("username") ||
            placeholder.includes("email") ||
            placeholder.includes("password")
        ) {
            return true;
        }

        // -----------------------------
        // Important navigation
        // -----------------------------
        if (
            text === "web" ||
            text === "dashboard" ||
            text === "home" ||
            text === "settings"
        ) {
            return true;
        }

        // -----------------------------
        // Important actions
        // -----------------------------
        if (
            text.includes("log in") ||
            text.includes("login") ||
            text.includes("sign in") ||
            text.includes("run") ||
            text.includes("deploy") ||
            text.includes("restart") ||
            text.includes("save")
        ) {
            return true;
        }

        // Ignore everything else
        return false;

    }

}

module.exports = KnowledgeFilter;