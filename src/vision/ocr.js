const logger = require("../utils/logger");
const { normalize } = require("../utils/fingerprint");

const TRANSCRIBE = `Transcribe every piece of text visible in this screenshot.
Preserve reading order. Return plain text only, no commentary.`;

const LOCATE = `Find the text described by the request in this screenshot.

Return ONE JSON object:

{ "found": true, "text": "the exact text", "x": 120, "y": 340, "reason": "..." }

x and y are the pixel centre of that text in this image, top-left origin.
If it is not visible, return { "found": false, "reason": "..." }.
Never use markdown.`;

// Text extraction. The multimodal model already reads screens, so there is no
// OCR dependency here — tesseract.js is used only if it happens to be installed.
class Ocr {

    constructor(analyzer, options = {}) {

        this.analyzer = analyzer;
        this.preferLocal = options.preferLocal ?? false;
        this.language = options.language || "eng";

    }

    async text(image) {

        if (this.preferLocal) {

            const local = await this.local(image);

            if (local !== null) {
                return local;
            }

        }

        return this.analyzer.describe(image, TRANSCRIBE);

    }

    // ponytail: optional local backend, only if the user already installed it.
    async local(image) {

        let tesseract;

        try {
            tesseract = require("tesseract.js");
        }
        catch {
            logger.debug("tesseract.js not installed — using the vision model.");
            return null;
        }

        const buffer = Buffer.isBuffer(image) ? image : image?.buffer;

        if (!buffer) {
            return null;
        }

        const result = await tesseract.recognize(buffer, this.language);

        return result?.data?.text ?? null;

    }

    async contains(image, needle) {

        const text = await this.text(image);

        return normalize(text).includes(normalize(needle));

    }

    // Where on screen is this text? Returns click coordinates when found.
    async locate(image, description) {

        const found = await this.analyzer.analyze(
            image,
            `${LOCATE}\n\nRequest: ${description}`
        );

        if (!found?.found) {
            return null;
        }

        if (typeof found.x !== "number" || typeof found.y !== "number") {
            return null;
        }

        return found;

    }

}

module.exports = Ocr;
module.exports.TRANSCRIBE = TRANSCRIBE;
