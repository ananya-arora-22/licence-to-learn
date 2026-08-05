(() => {
  "use strict";

  const DEBOUNCE = 180;

  let worker = null;
  let ready = false;
  let seq = 0;
  let pending = null;

  const listeners = new Set();

  function boot(urls) {
    if (worker) return;
    try {
      worker = new Worker(urls.worker);
    } catch {
      return false;
    }

    worker.addEventListener("message", ({ data }) => {
      if (data.type === "ready") {
        ready = true;
        if (pending !== null) {
          const q = pending;
          pending = null;
          doSend(q);
        }
      }
      for (const fn of listeners) fn(data);
    });

    worker.addEventListener("error", () => {});
    worker.postMessage({ type: "init", url: urls.index });
    return true;
  }

  function doSend(q) {
    if (!ready) {
      pending = q;
      return;
    }
    worker.postMessage({ type: "query", q, seq: ++seq });
  }

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

  /* ------------------------------------------------------------------
     Nav-dropdown search  (global, every page)
     ------------------------------------------------------------------ */
  const navRoot = document.querySelector(".header-search[data-rti-search]");
  if (navRoot) {
    const form = navRoot.querySelector(".header-search__form");
    const input = navRoot.querySelector(".header-search__input");
    const drop = navRoot.querySelector(".header-search__drop");
    const urls = {
      index: navRoot.dataset.index,
      worker: navRoot.dataset.worker,
    };
    const searchUrl = navRoot.dataset.searchUrl;
    let mySeq = 0;
    let timer = null;

    form.addEventListener("submit", (e) => e.preventDefault());

    input.addEventListener(
      "focus",
      () => {
        boot(urls);
      },
      { once: true }
    );

    listeners.add(({ data }) => {
      if (data.type !== "results" || data.seq !== mySeq) return;
      renderDrop(data);
    });

    function renderDrop({ hits, total }) {
      drop.replaceChildren();
      const q = input.value.trim();

      if (!hits || !hits.length) {
        drop.insertAdjacentHTML(
          "beforeend",
          '<div class="header-search__empty">No matches</div>'
        );
        drop.hidden = false;
        return;
      }

      const list = document.createElement("ul");
      list.className = "header-search__results";

      for (let i = 0; i < Math.min(hits.length, 5); i++) {
        const h = hits[i];
        const li = document.createElement("li");
        li.className = "header-search__hit";
        li.innerHTML =
          `<a class="header-search__link" href="${h.url}#page=${h.page}" target="_blank" rel="noopener noreferrer"><span>${h.institute}</span> <span class="pill">${h.type}</span></a>` +
          `<div class="header-search__snippet">${h.excerpt.slice(0, 120)}</div>`;
        list.append(li);
      }

      if (total > 5) {
        const more = document.createElement("li");
        more.className = "header-search__more";
        more.innerHTML = `<a href="${searchUrl}?q=${encodeURIComponent(q)}">See all ${total} results</a>`;
        list.append(more);
      }

      drop.append(list);
      drop.hidden = false;
    }

    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const q = input.value.trim();
        if (!q) {
          drop.hidden = true;
          drop.replaceChildren();
          return;
        }
        boot(urls);
        if (ready) {
          mySeq = ++seq;
          worker.postMessage({ type: "query", q, seq: mySeq });
        }
      }, DEBOUNCE);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        input.value = "";
        drop.hidden = true;
        drop.replaceChildren();
      }
    });

    document.addEventListener("click", (e) => {
      if (!navRoot.contains(e.target)) {
        drop.hidden = true;
        drop.replaceChildren();
      }
    });
  }

  /* ------------------------------------------------------------------
     Full-page search  (/search page)
     ------------------------------------------------------------------ */
  const pageRoot = document.querySelector(".rti-search[data-rti-search]");
  if (pageRoot) {
    const form = pageRoot.querySelector(".search-form");
    const input = pageRoot.querySelector(".search-input");
    const status = pageRoot.querySelector(".search-status");
    const results = pageRoot.querySelector(".search-results");
    const browse = document.querySelector("[data-rti-browse]");
    const urls = {
      index: pageRoot.dataset.index,
      worker: pageRoot.dataset.worker,
    };
    let mySeq = 0;
    let timer = null;

    form.addEventListener("submit", (e) => e.preventDefault());

    const say = (msg) => {
      status.textContent = msg;
    };

    input.addEventListener(
      "focus",
      () => {
        boot(urls);
        if (!ready) say("Loading the documents…");
      },
      { once: true }
    );

    listeners.add(({ data }) => {
      if (data.type === "ready") {
        ready = true;
        say("Ready");
      }
      if (data.type === "results" && data.seq === mySeq) render(data);
    });

    function render({ hits, total }) {
      results.replaceChildren();

      if (!hits.length) {
        say("No matches. Try a different term.");
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
    }

    const onInput = () => {
      const q = input.value.trim();
      const url = new URL(location.href);
      if (q) url.searchParams.set("q", q);
      else url.searchParams.delete("q");
      history.replaceState(null, "", url);

      if (!q) {
        mySeq = ++seq;
        results.replaceChildren();
        say("");
        if (browse) browse.hidden = false;
        return;
      }

      if (ready) {
        mySeq = ++seq;
        worker.postMessage({ type: "query", q, seq: mySeq });
      }
    };

    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(onInput, DEBOUNCE);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !input.value) return;
      input.value = "";
      onInput();
    });

    const initial = new URLSearchParams(location.search).get("q");
    if (initial) {
      input.value = initial;
      onInput();
    }
  }
})();
