import consumer from "../functions/ncs/consumer";

// Cloudflare Pages Functions can enqueue control messages, but the queue consumer itself
// must run as a Worker entrypoint with a `queue()` export.
export default consumer;
