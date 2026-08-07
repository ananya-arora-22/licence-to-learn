/* Tiny dependency-free line chart. Enhances every .linechart element:
   builds an inline SVG (accent line + area gradient + nodes, X=year, Y=amount)
   from data-values (comma numbers) and data-labels (comma years). Hover/focus a
   node for a themed pill with the value in lakh/crore. Text fallback without JS. */
(() => {
  "use strict";
  const SVGNS = "http://www.w3.org/2000/svg";

  const fmtFull = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  // long form for the tooltip: "2.57 crore INR" / "77 lakh INR" / "₹4,200"
  const words = (n) => {
    if (n >= 1e7) return `${(n / 1e7).toFixed(2).replace(/\.?0+$/, "")} crore INR`;
    if (n >= 1e5) return `${Math.round(n / 1e5)} lakh INR`;
    return fmtFull.format(n);
  };
  // Missing / NaN / empty cells are treated as 0; a 0 reads as no data, not ₹0.
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const valLabel = (v) => (v === 0 ? "data not provided or collected" : words(v));
  // Compact suffix shown in brackets beside a full ₹ number: "2.3 Cr" / "1.5 L".
  const shortINR = (n) => {
    if (n >= 1e7) return `${(n / 1e7).toFixed(2).replace(/\.?0+$/, "")} Cr`;
    if (n >= 1e5) return `${(n / 1e5).toFixed(2).replace(/\.?0+$/, "")} L`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.?0+$/, "")}k`;
    return "";
  };
  // short form for the Y axis: "2.6cr" / "77L" / "4200"
  const axisShort = (n) => {
    if (n >= 1e7) return `${(n / 1e7).toFixed(1)}cr`;
    if (n >= 1e5) return `${Math.round(n / 1e5)}L`;
    if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
    return `${n}`;
  };
  const el = (name, attrs, text) => {
    const n = document.createElementNS(SVGNS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  };
  // n+1 evenly spaced tick values from lo to hi (for Y-axis gridlines/labels).
  const ticks = (lo, hi, n) => Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);

  const draw = (box, domainMax) => {
    const values = (box.dataset.values || "").split(",").map(num);
    const labels = (box.dataset.labels || "").split(",");
    if (values.filter((v) => v > 0).length < 2) return; // not enough to plot

    const W = 320, H = 190, padL = 44, padR = 12, padT = 14, padB = 26;
    const max = domainMax != null ? domainMax : Math.max(...values);
    const min = domainMax != null ? 0 : Math.min(...values);
    const range = max - min || 1;
    const stepX = (W - padL - padR) / (values.length - 1);
    const x = (i) => padL + i * stepX;
    const y = (v) => padT + (1 - (v - min) / range) * (H - padT - padB);

    const uid = `lc${values.length}_${Math.round(max)}`;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "linechart__svg", role: "img" });
    svg.setAttribute("aria-label", box.getAttribute("aria-label") || "spending by year");

    const defs = el("defs", {});
    const grad = el("linearGradient", { id: uid, x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.append(el("stop", { offset: "0%", "stop-color": "var(--accent)", "stop-opacity": "0.28" }));
    grad.append(el("stop", { offset: "100%", "stop-color": "var(--accent)", "stop-opacity": "0" }));
    defs.append(grad);
    svg.append(defs);

    // Y axis: evenly spaced gridlines + labels across the domain
    ticks(min, max, 4).forEach((v) => {
      const yy = y(v);
      svg.append(el("line", { x1: padL, y1: yy.toFixed(1), x2: W - padR, y2: yy.toFixed(1), class: "lc-grid" }));
      svg.append(el("text", { x: padL - 6, y: (yy + 3).toFixed(1), class: "lc-ylabel", "text-anchor": "end" }, axisShort(v)));
    });

    // X axis: year labels under each point
    labels.forEach((lab, i) => {
      svg.append(el("text", { x: x(i).toFixed(1), y: H - padB + 14, class: "lc-xlabel", "text-anchor": "middle" }, lab));
    });

    // area + line
    const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    svg.append(el("path", { d: `${line} L${x(values.length - 1).toFixed(1)},${y(min)} L${x(0).toFixed(1)},${y(min)} Z`, fill: `url(#${uid})`, stroke: "none" }));
    svg.append(el("path", { d: line, fill: "none", stroke: "var(--accent)", "stroke-width": "2", "stroke-linejoin": "round", "stroke-linecap": "round" }));

    const tip = document.createElement("div");
    tip.className = "linechart__tip";
    tip.hidden = true;

    // nodes
    values.forEach((v, i) => {
      const cls = v > 0 ? "linechart__node" : "linechart__node is-empty";
      const node = el("circle", { cx: x(i).toFixed(1), cy: y(v).toFixed(1), r: "4", class: cls, tabindex: "0", role: "button" });
      const label = `${labels[i] ? labels[i] + ": " : ""}${valLabel(v)}`;
      node.setAttribute("aria-label", label);
      const show = () => {
        tip.textContent = label;
        tip.hidden = false;
        tip.style.insetInlineStart = `${(x(i) / W) * 100}%`;
        tip.style.insetBlockStart = `${(y(v) / H) * 100}%`;
        node.classList.add("is-active");
      };
      const hide = () => {
        tip.hidden = true;
        node.classList.remove("is-active");
      };
      node.addEventListener("pointerenter", show);
      node.addEventListener("pointerleave", hide);
      node.addEventListener("focus", show);
      node.addEventListener("blur", hide);
      svg.append(node);
    });

    box.textContent = "";
    box.append(svg, tip);
  };

  // Shared bar-fill defs (solid accent gradient for reported years, a hatch
  // pattern standing in for zero/unreported ones instead of a misleadingly
  // flat solid bar) plus a hover/focus tooltip wired identically for every
  // bar — no permanent callout, so it doesn't crowd small charts and keeps
  // one interaction pattern across the mini and full-size charts.
  const barDefs = (svg, uid) => {
    const defs = el("defs", {});
    const grad = el("linearGradient", { id: uid, x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.append(el("stop", { offset: "0%", "stop-color": "var(--accent)", "stop-opacity": "1" }));
    grad.append(el("stop", { offset: "100%", "stop-color": "var(--accent)", "stop-opacity": "0.2" }));
    defs.append(grad);
    const hatchId = `${uid}h`;
    const hatch = el("pattern", { id: hatchId, patternUnits: "userSpaceOnUse", width: "5", height: "5", patternTransform: "rotate(45)" });
    hatch.append(el("line", { x1: "0", y1: "0", x2: "0", y2: "5", stroke: "var(--body)", "stroke-width": "2", opacity: "0.5" }));
    defs.append(hatch);
    svg.append(defs);
    return { fillId: `url(#${uid})`, hatchId: `url(#${hatchId})` };
  };

  const wireBarTip = (box, tipClass) => {
    const tip = document.createElement("div");
    tip.className = tipClass;
    tip.hidden = true;
    box.append(tip);
    return {
      show(label, xPct, yPct) {
        tip.textContent = label;
        tip.hidden = false;
        tip.style.insetInlineStart = `${xPct}%`;
        tip.style.insetBlockStart = `${yPct}%`;
      },
      hide() { tip.hidden = true; },
    };
  };

  // Compact 5-bar sparkline (institute cards). Shares the values/labels
  // contract with the full chart above.
  const drawMini = (box) => {
    const values = (box.dataset.values || "").split(",").map(num);
    const labels = (box.dataset.labels || "").split(",");
    if (!values.length) return;

    const W = 140, H = 72, gap = 4;
    const n = values.length;
    const barW = (W - gap * (n - 1)) / n;
    const max = Math.max(...values, 1);

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "linechart__mini-svg", role: "img" });
    svg.setAttribute("aria-label", box.getAttribute("aria-label") || "spending by year");
    const { fillId, hatchId } = barDefs(svg, `lcm${n}_${Math.round(max)}`);

    box.textContent = "";
    box.append(svg);
    const tip = wireBarTip(box, "linechart__callout");

    values.forEach((v, i) => {
      // No-data years hatch the full column height, not a sliver, so "no
      // data" reads as a deliberate state rather than a rounding error.
      const h = v > 0 ? Math.max(4, (v / max) * (H - 4)) : H - 4;
      const bx = i * (barW + gap);
      const y = H - h;
      const bar = el("rect", {
        x: bx.toFixed(1), y: y.toFixed(1), width: barW.toFixed(1), height: h.toFixed(1),
        rx: "2", fill: v > 0 ? fillId : hatchId, class: "lcm-bar", tabindex: "0", role: "img",
      });
      const ariaLabel = `${labels[i] ? labels[i] + ": " : ""}${valLabel(v)}`;
      bar.setAttribute("aria-label", ariaLabel);
      svg.append(bar);

      const tipLabel = `${valLabel(v)}${labels[i] ? ` (${labels[i]})` : ""}`;
      const showTip = () => tip.show(tipLabel, ((bx + barW / 2) / W) * 100, 0);
      bar.addEventListener("pointerenter", showTip);
      bar.addEventListener("focus", showTip);
      bar.addEventListener("pointerleave", tip.hide);
      bar.addEventListener("blur", tip.hide);
    });
  };

  // Full-size bar chart (institution page): gradient bars, gridlines shared
  // with draw() above. The viewBox is sized to the container's own rendered
  // pixels (not a fixed 320x190) so it can stretch to match a taller sibling
  // card (see .institution__grid) without distorting text — a fixed
  // viewBox stretched via preserveAspectRatio="none" warps the glyphs.
  const drawBar = (box) => {
    const values = (box.dataset.values || "").split(",").map(num);
    const labels = (box.dataset.labels || "").split(",");
    if (!values.length) return;

    const rect = box.getBoundingClientRect();
    const W = Math.max(200, Math.round(rect.width) || 320);
    const H = Math.max(140, Math.round(rect.height) || 190);
    const padL = 30, padR = 4, padT = 20, padB = 22, gap = 7;
    const max = Math.max(...values, 1);
    const n = values.length;
    const barW = (W - padL - padR - gap * (n - 1)) / n;
    const x = (i) => padL + i * (barW + gap);
    // No-data years hatch the full plot height, not a sliver, so "no data"
    // reads as a deliberate state rather than a rounding error.
    const barH = (v) => (v > 0 ? Math.max(2, (v / max) * (H - padT - padB)) : H - padT - padB);

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "barchart__svg", role: "img" });
    svg.setAttribute("aria-label", box.getAttribute("aria-label") || "spending by year");
    const { fillId, hatchId } = barDefs(svg, `bc${n}_${Math.round(max)}`);

    ticks(0, max, 4).forEach((v) => {
      const yy = padT + (1 - v / max) * (H - padT - padB);
      svg.append(el("line", { x1: padL, y1: yy.toFixed(1), x2: W - padR, y2: yy.toFixed(1), class: "lc-grid" }));
      svg.append(el("text", { x: padL - 6, y: (yy + 3).toFixed(1), class: "lc-ylabel", "text-anchor": "end" }, axisShort(v)));
    });

    labels.forEach((lab, i) => {
      svg.append(el("text", { x: (x(i) + barW / 2).toFixed(1), y: H - padB + 14, class: "lc-xlabel", "text-anchor": "middle" }, lab));
    });

    box.textContent = "";
    box.append(svg);
    const tip = wireBarTip(box, "barchart__callout");

    values.forEach((v, i) => {
      const h = barH(v);
      const barY = H - padB - h;
      const bar = el("rect", {
        x: x(i).toFixed(1), y: barY.toFixed(1), width: barW.toFixed(1), height: h.toFixed(1),
        rx: "4", fill: v > 0 ? fillId : hatchId, class: "barchart__bar",
      });
      const ariaLabel = `${labels[i] ? labels[i] + ": " : ""}${valLabel(v)}`;
      bar.setAttribute("aria-label", ariaLabel);
      bar.setAttribute("tabindex", "0");
      bar.setAttribute("role", "img");
      svg.append(bar);

      const tipLabel = `${valLabel(v)}${labels[i] ? ` (${labels[i]})` : ""}`;
      const showTip = () => tip.show(tipLabel, ((x(i) + barW / 2) / W) * 100, (barY / H) * 100);
      bar.addEventListener("pointerenter", showTip);
      bar.addEventListener("focus", showTip);
      bar.addEventListener("pointerleave", tip.hide);
      bar.addEventListener("blur", tip.hide);
    });
  };

  // Each card scales to its own max, like a normal standalone chart.
  document.querySelectorAll(".linechart").forEach((box) => {
    if (box.classList.contains("linechart--mini")) drawMini(box);
    else draw(box, null);
  });
  document.querySelectorAll(".barchart").forEach(drawBar);

  // [data-inr]: compact form by default (e.g. "₹1.9 Cr"); the exact
  // Indian-grouped figure sits in the native `title` tooltip, revealed on
  // hover/focus, rather than always showing both at once.
  document.querySelectorAll("[data-inr]").forEach((n) => {
    const v = Number(n.dataset.inr);
    if (!Number.isFinite(v)) return;
    const s = shortINR(v);
    n.textContent = s ? `₹${s}` : fmtFull.format(v);
    if (s) n.title = fmtFull.format(v);
  });
})();
