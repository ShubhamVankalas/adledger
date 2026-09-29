/* AdLedger website: progressive enhancement only. Every section reads and works without this
   file; it adds the sticky product tour, install tabs, copy buttons and small pointer effects.
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
  function pad(n) { return (n < 10 ? "0" : "") + n; }

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

  /* ---------- pointer effects: spotlight cards, magnetic buttons, hero tilt ---------- */
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

    var visual = doc.querySelector("[data-tilt]");
    var tilt = visual && visual.querySelector(".tilt");
    var hero = visual && visual.closest(".hero");
    if (tilt && hero) {
      var frameEl = tilt.querySelector(".hero-frame");
      var pending = null;
      var queued = false;
      hero.addEventListener("pointermove", function (e) {
        if (e.pointerType !== "mouse" || window.innerWidth <= 900) return;
        pending = e;
        if (queued) return;
        queued = true;
        requestAnimationFrame(function () {
          queued = false;
          var ev = pending;
          if (!ev) return;
          var r = visual.getBoundingClientRect();
          var px = clamp((ev.clientX - r.left) / r.width - 0.5, -0.75, 0.75);
          var py = clamp((ev.clientY - r.top) / r.height - 0.5, -0.75, 0.75);
          tilt.classList.add("tracking");
          tilt.style.setProperty("--rx", (-py * 5).toFixed(2) + "deg");
          tilt.style.setProperty("--ry", (px * 7).toFixed(2) + "deg");
          if (frameEl) {
            frameEl.style.setProperty("--sheen", "0.14");
            frameEl.style.setProperty("--sx", (50 - px * 80).toFixed(1) + "%");
          }
        });
      });
      hero.addEventListener("pointerleave", function () {
        pending = null;
        tilt.classList.remove("tracking");
        tilt.style.setProperty("--rx", "0deg");
        tilt.style.setProperty("--ry", "0deg");
        if (frameEl) frameEl.style.setProperty("--sheen", "0");
      });
    }
  }

  /* ---------- product tour: a sticky device that follows the feature you are reading ---------- */
  $all("[data-show]").forEach(function (show) {
    var steps = $all(".step", show);
    if (!steps.length || !hasIO) return;
    var mq = window.matchMedia("(min-width: 1024px) and (min-height: 620px)");
    var stage, urlEl, nowNum, nowLabel, layers = [], links = [], active = -1, io, warmed = false;

    function el(tag, cls, parent) {
      var n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (parent) parent.appendChild(n);
      return n;
    }

    function build() {
      stage = el("div", "stage");
      var rig = el("div", "rig", stage);
      var frame = el("div", "frame", rig);
      frame.setAttribute("aria-hidden", "true");
      var bar = el("div", "frame-bar", frame);
      bar.innerHTML = "<i></i><i></i><i></i>";
      urlEl = el("span", "", bar);
      var screen = el("div", "screen", frame);
      steps.forEach(function (step) {
        var img = step.querySelector(".step-shot img");
        var layer;
        if (img) {
          layer = el("img", "layer", screen);
          layer.alt = "";
          layer.width = 1440;
          layer.height = 900;
          layer.decoding = "async";
          layer.setAttribute("data-src", img.getAttribute("src"));
        } else {
          var term = step.querySelector(".step-shot .tty");
          layer = term ? term.cloneNode(true) : el("div");
          layer.classList.add("layer");
          screen.appendChild(layer);
        }
        layers.push(layer);
      });
      var tour = el("nav", "stage-nav", rig);
      tour.setAttribute("aria-label", "Product tour progress");
      var now = el("div", "stage-now", tour);
      nowNum = el("span", "num", now);
      nowLabel = el("span", "", now);
      var segs = el("div", "segs", tour);
      steps.forEach(function (step, i) {
        var a = el("a", "", segs);
        a.href = "#" + step.id;
        a.setAttribute("aria-label", pad(i + 1) + " " + step.getAttribute("data-label"));
        links.push(a);
      });
      show.insertBefore(stage, show.firstChild);
    }

    function load(i) {
      var layer = layers[i];
      if (layer && layer.tagName === "IMG" && !layer.getAttribute("src")) layer.src = layer.getAttribute("data-src");
    }

    function warm() {
      if (warmed) return;
      warmed = true;
      var i = 0;
      (function next() {
        if (i >= layers.length) return;
        load(i++);
        setTimeout(next, 180);
      })();
    }

    function setActive(i) {
      if (i === active || i < 0) return;
      active = i;
      load(i); load(i + 1); load(i - 1);
      steps.forEach(function (s, j) { s.classList.toggle("is-active", j === i); });
      layers.forEach(function (l, j) { l.classList.toggle("on", j === i); });
      links.forEach(function (a, j) {
        if (j === i) a.setAttribute("aria-current", "step");
        else a.removeAttribute("aria-current");
        a.classList.toggle("done", j < i);
      });
      stage.setAttribute("data-side", i % 2 === 0 ? "right" : "left");
      urlEl.textContent = steps[i].getAttribute("data-url");
      nowNum.textContent = pad(i + 1) + " / " + pad(steps.length);
      nowLabel.textContent = steps[i].getAttribute("data-label");
    }

    function enable() {
      if (!stage) build();
      show.classList.add("staged");
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { setActive(steps.indexOf(e.target)); warm(); }
        });
      }, { rootMargin: "-45% 0px -54% 0px" });
      steps.forEach(function (s) { io.observe(s); });
      if (active < 0) setActive(0);
    }

    function disable() {
      show.classList.remove("staged");
      if (io) io.disconnect();
    }

    if (mq.matches) enable();
    var onChange = function (e) { if (e.matches) enable(); else disable(); };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
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
