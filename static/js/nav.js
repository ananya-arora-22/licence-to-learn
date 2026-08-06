/* Close the <details> dropdown(s) on outside-click and Escape.
   The menu still opens/closes via the summary without JS; this only adds
   the dismiss behaviour native <details> lacks.
   Also wires the mobile hamburger (.nav-toggle) that collapses the primary
   nav on narrow screens; it opens/closes via a data-open attribute so the
   nav is still just plain links/markup underneath. */
(() => {
  "use strict";
  const menus = document.querySelectorAll("details.menu");

  document.addEventListener("click", (e) => {
    menus.forEach((m) => {
      if (m.open && !m.contains(e.target)) m.open = false;
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    menus.forEach((m) => {
      if (m.open) {
        m.open = false;
        m.querySelector("summary")?.focus();
      }
    });
  });

  const toggle = document.querySelector(".nav-toggle");
  const nav = document.getElementById("primary-nav");
  const iconOpen = toggle && toggle.querySelector("[data-icon-open]");
  const iconClose = toggle && toggle.querySelector("[data-icon-close]");
  if (toggle && nav) {
    const setOpen = (v) => {
      nav.toggleAttribute("data-open", v);
      toggle.setAttribute("aria-expanded", String(v));
      if (iconOpen) iconOpen.hidden = v;
      if (iconClose) iconClose.hidden = !v;
    };
    toggle.addEventListener("click", () => setOpen(!nav.hasAttribute("data-open")));
    nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
    document.addEventListener("click", (e) => {
      if (nav.hasAttribute("data-open") && !nav.contains(e.target) && !toggle.contains(e.target)) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && nav.hasAttribute("data-open")) {
        setOpen(false);
        toggle.focus();
      }
    });
  }

  // "Spread this info" (institution page): copy the page URL, confirm via
  // the button's own note line instead of a toast.
  document.querySelectorAll("[data-copy-link]").forEach((btn) => {
    const note = btn.querySelector(".institution-action__note");
    const original = note ? note.textContent : "";
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.url || location.href);
        if (note) {
          note.textContent = "Copied!";
          setTimeout(() => { note.textContent = original; }, 1500);
        }
      } catch {
        /* clipboard unavailable (no permission / insecure context) — no-op */
      }
    });
  });
})();
