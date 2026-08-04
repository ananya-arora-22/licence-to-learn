/* Full-text search over the RTI response PDFs — the UI half.

   The page works without this file: templates/search.html already renders every
   document as a plain, linked list. This adds searching *inside* the documents.

   All the cost (fetch, parse, index, query) lives in search.worker.js, so this
   file only spawns the worker on first use, shows state, and renders hits.
   Nothing is downloaded for readers who never touch the search box. */
(() => {
  "use strict";

  const root = document.querySelector("[data-rti-search]");
  if (!root || typeof Worker === "undefined") return;

  const form = root.querySelector(".search-form");
  const input = root.querySelector(".search-input");
  const status = root.querySelector(".search-status");
  const results = root.querySelector(".search-results");
  const browse = document.querySelector("[data-rti-browse]");
  const DEBOUNCE = 180;

  let worker = null;
  let ready = false;
  let seq = 0; // guards against an older query resolving after a newer one
  let pending = null;
  let timer = null;

  // The form only exists to make Enter behave; searching is live.
  form.addEventListener("submit", (e) => e.preventDefault());

  const say = (msg) => {
    status.textContent = msg;
  };

  const boot = () => {
    if (worker) return;
    try {
      worker = new Worker(root.dataset.worker);
    } catch {
      // Worker unavailable (blocked, or opened over file://). The document
      // list below is still the whole point of the page.
      say("Search is unavailable here. The document list below still works.");
      return;
    }
    say("Loading the documents…");

    worker.addEventListener("message", ({ data }) => {
      if (data.type === "ready") {
        ready = true;
        say(`Ready — searching ${data.docs} documents.`);
        if (pending !== null) {
          const q = pending;
          pending = null;
          send(q);
        }
        return;
      }
      if (data.type === "error") {
        say("Could not load the search index. The document list below still works.");
        return;
      }
      if (data.type === "results" && data.seq === seq) render(data);
    });

    worker.addEventListener("error", () => {
      say("Search failed to start. The document list below still works.");
    });

    worker.postMessage({ type: "init", url: root.dataset.index });
  };

  const send = (q) => {
    if (!ready) {
      pending = q; // replayed once the worker reports ready
      return;
    }
    worker.postMessage({ type: "query", q, seq: ++seq });
  };

  /* Build the excerpt as text nodes with <mark> around matched terms — never
     innerHTML, since this text comes out of OCR and is not ours to trust. */
  const markUp = (text, terms) => {
    const frag = document.createDocumentFragment();
    const escaped = terms
      .filter(Boolean)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .sort((a, b) => b.length - a.length);
    if (!escaped.length) {
      frag.append(text);
      return frag;
    }
    const re = new RegExp(`(${escaped.join("|")})`, "ig");
    let last = 0;
    for (const m of text.matchAll(re)) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      const mark = document.createElement("mark");
      mark.textContent = m[0];
      frag.append(mark);
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    return frag;
  };

  const render = ({ hits, total }) => {
    results.replaceChildren();

    if (!hits.length) {
      say("No matches. Try fewer or different words.");
      if (browse) browse.hidden = false;
      return;
    }

    const shown = hits.length < total ? `Showing ${hits.length} of ${total}` : `${total}`;
    say(`${shown} matching page${total === 1 ? "" : "s"}.`);
    if (browse) browse.hidden = true;

    for (const hit of hits) {
      const li = document.createElement("li");
      li.className = "search-hit";

      const a = document.createElement("a");
      a.className = "search-hit__link";
      // #page=N is honoured by the built-in PDF viewers in Chrome, Firefox,
      // Edge and Safari, so a hit opens on the page it was found.
      a.href = `${hit.url}#page=${hit.page}`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = hit.institute;

      const meta = document.createElement("p");
      meta.className = "search-hit__meta";
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = hit.type;
      meta.append(pill, ` Page ${hit.page} of ${hit.pages}`);

      const snippet = document.createElement("p");
      snippet.className = "search-hit__excerpt";
      snippet.append(markUp(hit.excerpt, hit.terms));

      li.append(a, meta, snippet);
      results.append(li);
    }
  };

  const onInput = () => {
    const q = input.value.trim();

    // Keep the query in the URL so a search is a shareable link.
    const url = new URL(location.href);
    if (q) url.searchParams.set("q", q);
    else url.searchParams.delete("q");
    history.replaceState(null, "", url);

    if (!q) {
      seq++; // invalidate anything in flight
      results.replaceChildren();
      say("");
      if (browse) browse.hidden = false;
      return;
    }

    boot();
    send(q);
  };

  input.addEventListener("focus", boot, { once: true });
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(onInput, DEBOUNCE);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !input.value) return;
    input.value = "";
    onInput();
  });

  // Run a query supplied in the URL (?q=autodesk) on load.
  const initial = new URLSearchParams(location.search).get("q");
  if (initial) {
    input.value = initial;
    onInput();
  }
})();
