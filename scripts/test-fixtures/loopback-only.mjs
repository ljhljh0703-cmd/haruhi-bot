// Loaded only by the B-fix fixture runner. Never imported by production evaluators.
import Anthropic from "@anthropic-ai/sdk";
import { createRequire } from "node:module";
if (process.env.B_FIX_FIXTURE !== "1") throw new Error("fixture_preload_requires_explicit_flag");
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("fixture_non_loopback_blocked");
  const result = await realFetch(input, { ...init, redirect: "manual" });
  if (result.status >= 300 && result.status < 400) throw new Error("fixture_redirect_blocked");
  return result;
};
// A test-only request option avoids waiting through SDK retries on port 9.
const require = createRequire(import.meta.url);
const Common = require("@anthropic-ai/sdk");
for (const Client of new Set([Anthropic, Common.default ?? Common])) {
  const original = Client.prototype.request;
  Client.prototype.request = function (options, ...rest) {
    return original.call(this, Promise.resolve(options).then((o) => ({ ...o, maxRetries: 0, timeout: 500 })), 0, ...rest.slice(1));
  };
}
