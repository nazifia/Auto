// Runs up to `concurrency` tasks at once, with one rule: two tasks sharing a
// key never overlap. The key is the job's host — parallel runs against the same
// site would fight over one session file and one login.
class Queue {

    constructor({ concurrency = 2, maxPending = 50 } = {}) {

        this.concurrency = Math.max(1, concurrency);
        this.maxPending = maxPending;

        this.pending = [];
        this.active = new Set();
        this.running = 0;

    }

    get queued() {

        return this.pending.length;

    }

    push(key, task) {

        return new Promise((resolve, reject) => {

            if (this.pending.length >= this.maxPending) {

                reject(new Error("Queue is full."));

                return;

            }

            this.pending.push({ key, task, resolve, reject });

            this.drain();

        });

    }

    drain() {

        while (this.running < this.concurrency) {

            // Skip past tasks whose key is busy so a different host still runs —
            // otherwise one slow site blocks the whole queue.
            const index = this.pending.findIndex(item => !item.key || !this.active.has(item.key));

            if (index === -1) {
                return;
            }

            const [item] = this.pending.splice(index, 1);

            this.running++;

            if (item.key) {
                this.active.add(item.key);
            }

            // Release the slot before settling, so anything awaiting this task
            // sees an accurate running count.
            const settle = (finish, value) => {

                this.running--;

                if (item.key) {
                    this.active.delete(item.key);
                }

                finish(value);

                this.drain();

            };

            Promise.resolve()
                .then(item.task)
                .then(
                    value => settle(item.resolve, value),
                    error => settle(item.reject, error)
                );

        }

    }

}

module.exports = Queue;
