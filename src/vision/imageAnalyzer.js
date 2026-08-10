const OpenRouter = require("../ai/openrouter");
const config = require("../config");
const json = require("../utils/json");
const logger = require("../utils/logger");

// One primitive: ask a multimodal model a question about a screenshot.
// Everything else in vision/ is built on this.
class ImageAnalyzer {

    constructor(options = {}) {

        this.ai = options.ai || new OpenRouter();
        this.model = options.model || config.vision.model;

    }

    static dataUrl(image) {

        if (Buffer.isBuffer(image)) {
            return `data:image/png;base64,${image.toString("base64")}`;
        }

        if (typeof image === "string") {
            return image.startsWith("data:") ? image : `data:image/png;base64,${image}`;
        }

        if (image?.dataUrl) {
            return image.dataUrl;
        }

        if (image?.buffer) {
            return ImageAnalyzer.dataUrl(image.buffer);
        }

        throw new Error("ImageAnalyzer needs a Buffer, base64 string, or screenshot object.");

    }

    static message(prompt, image) {

        return {
            role: "user",
            content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: ImageAnalyzer.dataUrl(image) } }
            ]
        };

    }

    async ask(image, prompt, options = {}) {

        const messages = [];

        if (options.system) {
            messages.push({ role: "system", content: options.system });
        }

        messages.push(ImageAnalyzer.message(prompt, image));

        const reply = await this.ai.chat(messages, {
            model: options.model || this.model,
            json: options.json !== false
        });

        logger.debug("VISION RESPONSE", reply);

        return reply;

    }

    // JSON answer. The caller decides the shape via the prompt.
    async analyze(image, prompt, options = {}) {

        const reply = await this.ask(image, prompt, options);

        return json.parse(reply);

    }

    // Free text answer — no response_format, no JSON extraction.
    async describe(image, prompt = "Describe what is on this screen.", options = {}) {

        return this.ask(image, prompt, { ...options, json: false });

    }

}

module.exports = ImageAnalyzer;
