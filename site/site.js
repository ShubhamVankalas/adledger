/* AdLedger website: progressive enhancement only. Every section reads and works without this
   file; it adds scroll reveals, the word light-up, install tabs, copy buttons and small pointer
   effects. The 3D product story is a separate module (site-3d.js).
   Motion is skipped when the visitor asks for reduced motion. No dependencies, no build step. */
(function () {
  "use strict";

  var doc = document;
  var root = doc.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var hasIO = "IntersectionObserver" in window;

  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  /* live region for short status messages (copy feedback) */
  var status = doc.createElement("div");
  status.className = "sr-only";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  doc.body.appendChild(status);
  function announce(text) { status.textContent = ""; setTimeout(function () { status.textContent = text; }, 30); }

  /* ---------- nav: scroll progress, current section, mobile menu ---------- */
  var nav = doc.querySelector(".nav");
  var navLinks = $all(".navlinks a[href^='#']");
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var max = root.scrollHeight - window.innerHeight;
      if (nav) nav.style.setProperty("--page-progress", max > 0 ? clamp(window.scrollY / max, 0, 1).toFixed(4) : "0");
      if (window.scrollY < 200) setCurrent(null);
    });
  }
  function setCurrent(id) {
    navLinks.forEach(function (a) {
      if (id && a.getAttribute("href") === "#" + id) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  if (hasIO && navLinks.length) {
    var navIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) setCurrent(e.target.id); });
    }, { rootMargin: "-45% 0px -54% 0px" });
    navLinks.forEach(function (a) {
      var target = doc.getElementById(a.getAttribute("href").slice(1));
      if (target) navIO.observe(target);
    });
  }

  var menu = doc.querySelector(".menu");
  if (menu) {
    menu.addEventListener("click", function (e) { if (e.target.closest("a")) menu.open = false; });
    doc.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menu.open) { menu.open = false; menu.querySelector("summary").focus(); }
    });
    doc.addEventListener("click", function (e) { if (menu.open && !menu.contains(e.target)) menu.open = false; });
  }

  /* ---------- reveal on scroll (only for content still below the fold) ---------- */
  if (!reduce && hasIO) {
    var revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        revealIO.unobserve(el);
        el.classList.add("reveal-run");
        requestAnimationFrame(function () { el.classList.remove("reveal-pre"); });
        el.addEventListener("transitionend", function done(ev) {
          if (ev.target !== el || ev.propertyName !== "opacity") return;
          el.removeEventListener("transitionend", done);
          el.classList.remove("reveal-run");
          el.style.transitionDelay = "";
        });
      });
    }, { rootMargin: "0px 0px -6% 0px" });
    var fold = window.innerHeight * 0.94;
    $all("[data-reveal]").forEach(function (el) {
      if (el.getBoundingClientRect().top <= fold) return;
      var siblings = $all(":scope > [data-reveal]", el.parentElement);
      var i = siblings.indexOf(el);
      if (i > 0) el.style.transitionDelay = Math.min(i, 5) * 70 + "ms";
      el.classList.add("reveal-pre");
      revealIO.observe(el);
    });
    window.addEventListener("beforeprint", function () {
      $all(".reveal-pre").forEach(function (el) { el.classList.remove("reveal-pre"); });
    });
  }

  /* ---------- pointer effects: spotlight cards, magnetic buttons, 3D module tilt ---------- */
  if (finePointer) {
    $all("[data-glow]").forEach(function (el) {
      el.addEventListener("pointermove", function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty("--mx", (e.clientX - r.left).toFixed(0) + "px");
        el.style.setProperty("--my", (e.clientY - r.top).toFixed(0) + "px");
      });
    });
  }

  if (finePointer && !reduce) {
    $all("[data-magnetic]").forEach(function (el) {
      el.addEventListener("pointermove", function (e) {
        var r = el.getBoundingClientRect();
        var x = clamp((e.clientX - (r.left + r.width / 2)) * 0.25, -8, 8);
        var y = clamp((e.clientY - (r.top + r.height / 2)) * 0.35, -5, 5);
        el.style.translate = x.toFixed(1) + "px " + y.toFixed(1) + "px";
      });
      el.addEventListener("pointerleave", function () { el.style.translate = ""; });
    });

    // 3D modules lean toward the pointer (the CSS keeps them floating)
    $all("[data-mod]").forEach(function (el) {
      var pending = null;
      var queued = false;
      el.addEventListener("pointermove", function (e) {
        if (e.pointerType !== "mouse") return;
        pending = e;
        if (queued) return;
        queued = true;
        requestAnimationFrame(function () {
          queued = false;
          if (!pending) return;
          var r = el.getBoundingClientRect();
          var px = clamp((pending.clientX - r.left) / r.width - 0.5, -0.6, 0.6);
          var py = clamp((pending.clientY - r.top) / r.height - 0.5, -0.6, 0.6);
          el.classList.add("tracking");
          el.style.setProperty("--rx", (-py * 18).toFixed(2) + "deg");
          el.style.setProperty("--ry", (px * 26).toFixed(2) + "deg");
        });
      });
      el.addEventListener("pointerleave", function () {
        pending = null;
        el.classList.remove("tracking");
        el.style.setProperty("--rx", "0deg");
        el.style.setProperty("--ry", "0deg");
      });
    });
  }

  /* ---------- product story without WebGL (phones, reduced motion, static page) ----------
     The 3D story itself lives in site-3d.js. Here the stacked screenshots tilt up into place. */
  if (!reduce && hasIO) {
    var shots = $all(".ch-shot");
    if (shots.length) {
      root.classList.add("tilt-in");
      var tiltIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.classList.add("in");
          tiltIO.unobserve(e.target);
        });
      }, { rootMargin: "0px 0px -12% 0px" });
      shots.forEach(function (s) { tiltIO.observe(s); });
    }
  }

  /* ---------- statement: the words light up one after another once it is on screen ---------- */
  $all("[data-lightup]").forEach(function (el) {
    if (reduce || !hasIO) return;
    var i = 0;
    $all("*", el).concat([el]).forEach(function (node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (t) {
        if (t.nodeType !== 3 || !t.textContent.trim()) return;
        var frag = doc.createDocumentFragment();
        t.textContent.split(/(\s+)/).forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(doc.createTextNode(part)); return; }
          var w = doc.createElement("span");
          w.className = "w";
          w.style.setProperty("--i", String(i++));
          w.textContent = part;
          frag.appendChild(w);
        });
        node.replaceChild(frag, t);
      });
    });
    el.classList.add("dim");
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { el.classList.toggle("dim", !e.isIntersecting); });
    }, { threshold: 0.6 });
    io.observe(el);
  });

  /* ---------- install tabs ---------- */
  $all("[data-tabs]").forEach(function (box) {
    var list = box.querySelector("[role=tablist]");
    if (!list) return;
    var tabs = $all("[role=tab]", list);
    var panels = tabs.map(function (t) { return doc.getElementById(t.getAttribute("aria-controls")); });
    list.hidden = false;
    function select(i, focus) {
      tabs.forEach(function (t, j) {
        var on = j === i;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        if (panels[j]) panels[j].hidden = !on;
      });
      if (focus) tabs[i].focus();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { select(i, false); });
      t.addEventListener("keydown", function (e) {
        var n = tabs.length;
        var next = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % n
          : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + n) % n
          : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
        if (next < 0) return;
        e.preventDefault();
        select(next, true);
      });
    });
    function fromHash() {
      var id = location.hash.slice(1);
      for (var i = 0; i < panels.length; i++) if (panels[i] && panels[i].id === id) return i;
      return -1;
    }
    var start = fromHash();
    select(start >= 0 ? start : 0, false);
    window.addEventListener("hashchange", function () {
      var i = fromHash();
      if (i >= 0) { select(i, false); panels[i].scrollIntoView({ block: "start" }); }
    });
  });

  /* ---------- copy buttons ---------- */
  var copyIcon = '<svg class="ico" aria-hidden="true"><use href="#i-copy" /></svg>';
  var checkIcon = '<svg class="ico" aria-hidden="true"><use href="#i-check" /></svg>';
  $all(".copy").forEach(function (b) {
    b.innerHTML = copyIcon + "<span>Copy</span>";
    b.addEventListener("click", function () {
      var pre = b.parentElement.querySelector("pre");
      if (!pre) return;
      var text = pre.textContent.replace(/\s+$/, "");
      var done = function () {
        b.classList.add("ok");
        b.innerHTML = checkIcon + "<span>Copied</span>";
        announce("Copied to the clipboard");
        setTimeout(function () { b.classList.remove("ok"); b.innerHTML = copyIcon + "<span>Copy</span>"; }, 1600);
      };
      var fallback = function () {
        var r = doc.createRange();
        r.selectNodeContents(pre);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        b.innerHTML = "<span>Selected</span>";
        announce("Selected. Press Control C or Command C to copy");
        setTimeout(function () { b.innerHTML = copyIcon + "<span>Copy</span>"; }, 2400);
      };
      try {
        navigator.clipboard.writeText(text).then(done, fallback);
      } catch { fallback(); }
    });
  });
})();
