// Runs in the page's MAIN world at document_start. Wraps fetch and XHR, sends matching
// response bodies to the isolated relay (shared.ts) and swaps in the rewritten body.
// Every failure path returns the original response (fail open).
import {
  INTERCEPT_TAG,
  matchesInterceptUrl,
  MAX_STREAM_BYTES,
  REWRITE_TIMEOUT_MS,
} from "../shared/intercept.js";

const pending = new Map<string, (body: string | null) => void>();
let seq = 0;

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const d: unknown = event.data;
  if (typeof d !== "object" || d === null) return;
  const m = d as { tag?: unknown; dir?: unknown; id?: unknown; body?: unknown };
  if (m.tag !== INTERCEPT_TAG || m.dir !== "res" || typeof m.id !== "string") return;
  pending.get(m.id)?.(typeof m.body === "string" ? m.body : null);
});

function rewrite(url: string, body: string): Promise<string | null> {
  return new Promise((resolve) => {
    const id = `${Date.now()}-${++seq}`;
    const done = (v: string | null): void => {
      clearTimeout(timer);
      pending.delete(id);
      resolve(v);
    };
    const timer = setTimeout(() => done(null), REWRITE_TIMEOUT_MS);
    pending.set(id, done);
    window.postMessage(
      { tag: INTERCEPT_TAG, dir: "req", id, url, pageUrl: location.href, body },
      location.origin,
    );
  });
}

function absolute(url: string): string {
  try {
    return new URL(url, location.href).href;
  } catch {
    return url;
  }
}

const origFetch = window.fetch;
window.fetch = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
  const res = await origFetch.call(this ?? window, input, init);
  try {
    const url = absolute(res.url || (input instanceof Request ? input.url : String(input)));
    if (!res.ok || !matchesInterceptUrl(url)) return res;
    if (Number(res.headers.get("content-length")) > MAX_STREAM_BYTES) return res;
    const text = await res.clone().text();
    if (text.length > MAX_STREAM_BYTES) return res;
    const out = await rewrite(url, text);
    if (out === null || out === text) return res;
    const headers = new Headers(res.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    const next = new Response(out, { status: res.status, statusText: res.statusText, headers });
    Object.defineProperty(next, "url", { value: res.url });
    return next;
  } catch {
    return res;
  }
};

// XHR: swallow readystatechange(4)/load/loadend until the rewrite lands, then define the
// rewritten body on the instance and replay the three events.
const OrigXHR = window.XMLHttpRequest;
const REPLAY = ["readystatechange", "load", "loadend"] as const;

class SieveXHR extends OrigXHR {
  #url = "";
  #released = false;
  #started = false;
  #gen = 0;

  constructor() {
    super();
    for (const type of REPLAY) this.addEventListener(type, (e) => this.#gate(e), true);
  }

  override open(method: string, url: string | URL, ...rest: [boolean?, string?, string?]): void {
    this.#url = absolute(String(url));
    this.#released = false;
    this.#started = false;
    this.#gen++;
    // A reused XHR must not serve the previous request's rewritten body.
    Reflect.deleteProperty(this, "responseText");
    Reflect.deleteProperty(this, "response");
    // @ts-expect-error spread of optional tuple matches the overloaded signature
    super.open(method, url, ...rest);
  }

  #gate(e: Event): void {
    if (this.#released || !matchesInterceptUrl(this.#url)) return;
    if (this.readyState !== 4) return;
    const t = this.responseType;
    if (this.status < 200 || this.status >= 300 || !(t === "" || t === "text" || t === "json")) {
      return;
    }
    e.stopImmediatePropagation();
    if (this.#started) return;
    this.#started = true;
    void this.#process();
  }

  async #process(): Promise<void> {
    const gen = this.#gen;
    try {
      const text =
        this.responseType === "json" ? JSON.stringify(this.response) : this.responseText;
      if (text.length <= MAX_STREAM_BYTES) {
        const out = await rewrite(this.#url, text);
        // Aborted or re-opened while the rewrite was pending: replaying would hit the wrong request.
        if (gen !== this.#gen || this.readyState !== 4) return;
        if (out !== null && out !== text) {
          Object.defineProperty(this, "responseText", { value: out, configurable: true });
          const value: unknown = this.responseType === "json" ? JSON.parse(out) : out;
          Object.defineProperty(this, "response", { value, configurable: true });
        }
      }
    } catch {
      // Fall through and replay the untouched response.
    }
    if (gen !== this.#gen || this.readyState !== 4) return;
    this.#released = true;
    this.dispatchEvent(new Event("readystatechange"));
    this.dispatchEvent(new ProgressEvent("load"));
    this.dispatchEvent(new ProgressEvent("loadend"));
  }
}

window.XMLHttpRequest = SieveXHR;
