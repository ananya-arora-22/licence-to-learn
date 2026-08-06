/* Progressive enhancement for any card grid marked [data-card-grid]: a
   search box, a cycling "Sort by" button, and a collapse-to-N + "Show all"
   button — inserted around the grid, no dependencies. The grid is complete
   and readable without this file (just unfiltered and uncollapsed).

   A [data-filter-tabs] bar's data-controls is a space-separated list of grid
   ids it drives — one bar can filter several grids at once. Each matching
   grid gets its own click listener on the shared tab buttons (harmless if
   more than one grid does this; each just runs its own apply()). Tab clicks
   also broadcast to any [data-type-swap] element on the page (see
   spend_counter.html / software_cards.html) so headings/counters elsewhere
   can swap to match the active type, independent of any specific grid. */
(() => {
  "use strict";

  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  const SORTS = [
    { key: "default", label: "Sort by" },
    { key: "value-desc", label: "Highest first" },
    { key: "value-asc", label: "Lowest first" },
    { key: "az", label: "A–Z" },
  ];

  // Type-swap elements match the active type exactly (one variant visible at
  // a time), unlike grid cards which match inclusively (data-type can list
  // several types, comma-separated, and any overlap with the active type keeps
  // the card visible).
  const updateTypeSwaps = (type) => {
    document.querySelectorAll("[data-type-swap]").forEach((el) => {
      el.hidden = (el.dataset.type || "") !== type;
    });
  };

  const enhance = (grid) => {
    const cards = () => [...grid.children].filter((el) => el.tagName === "ARTICLE");
    const all = cards();
    if (!all.length) return;

    const limit = parseInt(grid.dataset.limit, 10) || 6;
    const tabsBar = grid.id
      ? [...document.querySelectorAll("[data-filter-tabs]")].find((bar) =>
          (bar.dataset.controls || "").split(/\s+/).includes(grid.id))
      : null;
    const hideSelector = grid.dataset.hideUnlessSearch || null;
    const emptyNote = grid.parentElement.querySelector(`[data-empty-note]`);
    const comingSoonText = emptyNote ? emptyNote.textContent.trim() : "";

    const tools = document.createElement("div");
    tools.className = "card-tools";

    // Same glyphs as the ui::icon() Tera macro (search / arrows-sort), kept in
    // sync by hand since this file can't call into Tera templates.
    const searchIcon = '<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15.75 15.75L11.25 11.25M2.25 7.5C2.25 8.18944 2.3858 8.87213 2.64963 9.50909C2.91347 10.146 3.30018 10.7248 3.78769 11.2123C4.2752 11.6998 4.85395 12.0865 5.49091 12.3504C6.12787 12.6142 6.81056 12.75 7.5 12.75C8.18944 12.75 8.87213 12.6142 9.50909 12.3504C10.146 12.0865 10.7248 11.6998 11.2123 11.2123C11.6998 10.7248 12.0865 10.146 12.3504 9.50909C12.6142 8.87213 12.75 8.18944 12.75 7.5C12.75 6.81056 12.6142 6.12787 12.3504 5.49091C12.0865 4.85395 11.6998 4.2752 11.2123 3.78769C10.7248 3.30018 10.146 2.91347 9.50909 2.64963C8.87213 2.3858 8.18944 2.25 7.5 2.25C6.81056 2.25 6.12787 2.3858 5.49091 2.64963C4.85395 2.91347 4.2752 3.30018 3.78769 3.78769C3.30018 4.2752 2.91347 4.85395 2.64963 5.49091C2.3858 6.12787 2.25 6.81056 2.25 7.5Z"/></svg>';
    const sortIcon = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.33333 5.99981L4.66667 3.33315L2 5.99981M4.66667 3.33315V12.6665M8.66667 9.99981L11.3333 12.6665L14 9.99981M11.3333 12.6665V3.33315"/></svg>';

    const searchWrap = document.createElement("div");
    searchWrap.className = "card-search";
    searchWrap.innerHTML = searchIcon;
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = grid.dataset.searchPlaceholder || "Search…";
    search.setAttribute("aria-label", grid.dataset.searchPlaceholder || "Search");
    searchWrap.append(search);
    tools.append(searchWrap);

    let sortIdx = 0;
    const sortBtn = document.createElement("button");
    sortBtn.type = "button";
    sortBtn.className = "card-sort";
    const renderSortBtn = () => { sortBtn.innerHTML = `${sortIcon}<span>${SORTS[sortIdx].label}</span>`; };
    renderSortBtn();
    tools.append(sortBtn);

    grid.before(tools);

    let collapsed = true;
    const more = document.createElement("button");
    more.type = "button";
    more.className = "btn btn--surface card-more";
    grid.after(more);

    const apply = () => {
      const q = search.value.trim().toLowerCase();
      const activeType = tabsBar ? (tabsBar.querySelector(".filter-tab.is-active")?.dataset.type || "") : "";

      const byType = all.filter((el) => {
        if (!activeType) return true;
        return (el.dataset.type || "").split(",").includes(activeType);
      });
      const matches = byType.filter((el) => !q || el.textContent.toLowerCase().includes(q));
      // Cards matching hideSelector (e.g. institutes that never responded)
      // are hidden from default browsing, but reappear once the user is
      // actively searching by name.
      const visible = (!q && hideSelector) ? matches.filter((el) => !el.matches(hideSelector)) : matches;

      const sortKey = SORTS[sortIdx].key;
      const sorted = [...visible];
      if (sortKey === "value-desc") sorted.sort((a, b) => num(b.dataset.sortValue) - num(a.dataset.sortValue));
      else if (sortKey === "value-asc") sorted.sort((a, b) => num(a.dataset.sortValue) - num(b.dataset.sortValue));
      else if (sortKey === "az") sorted.sort((a, b) => a.querySelector("h3").textContent.localeCompare(b.querySelector("h3").textContent));
      if (sortKey !== "default") sorted.forEach((el) => grid.append(el));

      const shown = new Set(collapsed ? sorted.slice(0, limit) : sorted);
      all.forEach((el) => { el.hidden = !shown.has(el); });

      const overflowing = sorted.length > limit;
      more.hidden = !overflowing;
      more.textContent = collapsed ? `Show all ${sorted.length}` : "Show less";

      if (emptyNote) {
        if (byType.length === 0) {
          emptyNote.textContent = comingSoonText;
          emptyNote.hidden = false;
        } else if (matches.length === 0) {
          emptyNote.textContent = "No matches for your search.";
          emptyNote.hidden = false;
        } else if (visible.length === 0) {
          emptyNote.textContent = "Nothing to show yet — none of these have reported data.";
          emptyNote.hidden = false;
        } else {
          emptyNote.hidden = true;
        }
      }
    };

    search.addEventListener("input", apply);
    sortBtn.addEventListener("click", () => {
      sortIdx = (sortIdx + 1) % SORTS.length;
      renderSortBtn();
      apply();
    });
    more.addEventListener("click", () => {
      collapsed = !collapsed;
      apply();
    });

    if (tabsBar) {
      const tabs = [...tabsBar.querySelectorAll(".filter-tab")];
      tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
          tabs.forEach((t) => {
            t.classList.toggle("is-active", t === tab);
            t.setAttribute("aria-selected", String(t === tab));
          });
          collapsed = true;
          apply();
          updateTypeSwaps(tab.dataset.type || "");
        });
      });
    }

    apply();
  };

  document.querySelectorAll("[data-card-grid]").forEach(enhance);

  // Keep the per-section sticky toolbar pinned directly under the sticky
  // filter-tabs bar, whatever its rendered height (it wraps to two lines on
  // narrow screens).
  const tabsShell = document.querySelector(".filter-tabs-sticky");
  if (tabsShell) {
    const setOffset = () => {
      document.documentElement.style.setProperty("--filter-tabs-h", `${tabsShell.getBoundingClientRect().height}px`);
    };
    setOffset();
    window.addEventListener("resize", setOffset);
  }
})();
