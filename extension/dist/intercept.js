"use strict";
(() => {
  // src/shared/intercept.ts
  var INTERCEPT_TAG = "sieve-intercept-v1";
  var MAX_STREAM_BYTES = 12 * 1024 * 1024;
  var REWRITE_TIMEOUT_MS = 6e3;
  var X_TIMELINE_OPS = [
    "HomeTimeline",
    "HomeLatestTimeline",
    "ExplorePage",
    "GenericTimelineById",
    "ExploreSidebar",
    "SearchTimeline"
  ];
  var INTERCEPT_URLS = [
    "https://www.youtube.com/youtubei/v1/browse*",
    "https://www.youtube.com/youtubei/v1/next*",
    "https://www.youtube.com/youtubei/v1/search*",
    "https://m.youtube.com/youtubei/v1/browse*",
    "https://m.youtube.com/youtubei/v1/next*",
    "https://m.youtube.com/youtubei/v1/search*",
    ...["x.com", "twitter.com"].flatMap(
      (h) => X_TIMELINE_OPS.map((op) => `https://${h}/i/api/graphql/*/${op}*`)
    ),
    "https://www.instagram.com/graphql/query*",
    "https://www.instagram.com/api/v1/clips/home/*",
    "https://www.instagram.com/api/v1/feed/timeline/*",
    "https://i.instagram.com/api/v1/clips/home/*",
    "https://i.instagram.com/api/v1/feed/timeline/*"
  ];
  var INTERCEPT_RES = INTERCEPT_URLS.map(
    (glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
  );
  function matchesInterceptUrl(url) {
    return INTERCEPT_RES.some((re) => re.test(url));
  }
  function worthRewriting(url, body) {
    if (!url.includes("instagram.com/graphql/query")) return true;
    return body.includes("feed__timeline") || body.includes("clips__home");
  }

  // src/content/intercept.ts
  var pending = /* @__PURE__ */ new Map();
  var seq = 0;
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (typeof d !== "object" || d === null) return;
    const m = d;
    if (m.tag !== INTERCEPT_TAG || m.dir !== "res" || typeof m.id !== "string") return;
    pending.get(m.id)?.(typeof m.body === "string" ? m.body : null);
  });
  function rewrite(url, body) {
    if (!worthRewriting(url, body)) return Promise.resolve(null);
    return new Promise((resolve) => {
      const id = `${Date.now()}-${++seq}`;
      const done = (v) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(v);
      };
      const timer = setTimeout(() => done(null), REWRITE_TIMEOUT_MS);
      pending.set(id, done);
      window.postMessage(
        { tag: INTERCEPT_TAG, dir: "req", id, url, pageUrl: location.href, body },
        location.origin
      );
    });
  }
  function absolute(url) {
    try {
      return new URL(url, location.href).href;
    } catch {
      return url;
    }
  }
  var origFetch = window.fetch;
  window.fetch = async function(input, init) {
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
  var OrigXHR = window.XMLHttpRequest;
  var REPLAY = ["readystatechange", "load", "loadend"];
  var SieveXHR = class extends OrigXHR {
    #url = "";
    #released = false;
    #started = false;
    #gen = 0;
    constructor() {
      super();
      for (const type of REPLAY) this.addEventListener(type, (e) => this.#gate(e), true);
    }
    open(method, url, ...rest) {
      this.#url = absolute(String(url));
      this.#released = false;
      this.#started = false;
      this.#gen++;
      Reflect.deleteProperty(this, "responseText");
      Reflect.deleteProperty(this, "response");
      super.open(method, url, ...rest);
    }
    #gate(e) {
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
    async #process() {
      const gen = this.#gen;
      try {
        const text = this.responseType === "json" ? JSON.stringify(this.response) : this.responseText;
        if (text.length <= MAX_STREAM_BYTES) {
          const out = await rewrite(this.#url, text);
          if (gen !== this.#gen || this.readyState !== 4) return;
          if (out !== null && out !== text) {
            Object.defineProperty(this, "responseText", { value: out, configurable: true });
            const value = this.responseType === "json" ? JSON.parse(out) : out;
            Object.defineProperty(this, "response", { value, configurable: true });
          }
        }
      } catch {
      }
      if (gen !== this.#gen || this.readyState !== 4) return;
      this.#released = true;
      this.dispatchEvent(new Event("readystatechange"));
      this.dispatchEvent(new ProgressEvent("load"));
      this.dispatchEvent(new ProgressEvent("loadend"));
    }
  };
  window.XMLHttpRequest = SieveXHR;
})();
