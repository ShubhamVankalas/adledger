/*
 * AdLedger for WordPress: lead capture for popular form plugins + WooCommerce visitor id.
 *
 * - Contact Form 7, WPForms, Gravity Forms, Elementor: the fields are read on submit and the
 *   lead is sent only after the plugin reports success (so failed validation isn't a lead).
 * - Other forms with an email field get data-adledger-lead, so the pixel records them on submit.
 * - WooCommerce classic checkout: fills the hidden adledger_vid field.
 */
(function () {
  "use strict";
  var w = window;
  var d = document;
  var cfg = w.adledgerWP || {};

  var PLUGIN_FORMS = ".wpcf7-form, .wpforms-form, form[id^='gform_'], .elementor-form";
  var SKIP_FORMS = [
    "form.checkout",
    "form.woocommerce-checkout",
    "form.cart",
    "form.woocommerce-cart-form",
    "form.woocommerce-form-login",
    "form.woocommerce-form-register",
    "form.woocommerce-EditAccountForm",
    "form.lost_reset_password",
    "#loginform",
    "#registerform",
    "#lostpasswordform",
    "#commentform",
    "form.comment-form",
    "form.search-form",
    "form[role='search']",
    "[data-adledger-ignore]",
  ].join(",");
  var STORE_KEY = "_al_wp_pending";
  var MAX_AGE = 10 * 60 * 1000;
  var pending = {};

  function matches(el, sel) {
    var fn = el && (el.matches || el.msMatchesSelector);
    return !!fn && fn.call(el, sel);
  }

  function visitorId() {
    var m = d.cookie.match(/(?:^|; )_al_vid=([^;]*)/);
    if (m) return decodeURIComponent(m[1]);
    var al = w.adledger;
    return (al && typeof al.getVisitorId === "function" && al.getVisitorId()) || "";
  }

  // Read email / phone / name from a form, using input types, names, ids and autocomplete hints.
  function traitsOf(form) {
    var t = {};
    var first = "";
    var last = "";
    var inputs = form.querySelectorAll("input");
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      var type = (el.type || "text").toLowerCase();
      if (/^(hidden|password|checkbox|radio|submit|button|file|image|reset)$/.test(type)) continue;
      var v = (el.value || "").trim();
      if (!v) continue;
      var key = [el.name, el.id, el.getAttribute("autocomplete")].join(" ").toLowerCase();
      var box = el.closest ? el.closest(".name_first, .name_last, .wpforms-field-name-first, .wpforms-field-name-last, .wpforms-field-name, .gfield--type-name") : null;
      if (!t.email && (type === "email" || /e-?mail/.test(key)) && v.indexOf("@") > 0) t.email = v;
      else if (!t.phone && (type === "tel" || /phone|mobile|(^|[^a-z])tel([^a-z]|$)/.test(key))) t.phone = v;
      else if (!first && (/given-name|first/.test(key) || matches(box, ".name_first, .wpforms-field-name-first"))) first = v;
      else if (!last && (/family-name|last/.test(key) || matches(box, ".name_last, .wpforms-field-name-last"))) last = v;
      else if (!t.name && !/user|company|business|file/.test(key) && (/(^|[^a-z])((full|your)[-_]?)?name([^a-z]|$)/.test(key) || box)) t.name = v;
    }
    if (!t.name && (first || last)) t.name = (first + " " + last).trim();
    return t;
  }

  function formKey(form) {
    if (form.id) return form.id;
    var cf7 = form.querySelector("input[name='_wpcf7_unit_tag']");
    if (cf7) return "cf7:" + cf7.value;
    var wpf = form.getAttribute("data-formid");
    if (wpf) return "wpforms:" + wpf;
    if (!form._alKey) form._alKey = "f" + Math.random().toString(36).slice(2);
    return form._alKey;
  }

  function formName(form) {
    var named = form.getAttribute("data-adledger-lead") || form.getAttribute("aria-label") || form.getAttribute("name");
    if (named) return named;
    if (matches(form, ".wpcf7-form")) {
      var id = form.querySelector("input[name='_wpcf7']");
      return "Contact Form 7" + (id ? " #" + id.value : "");
    }
    if (matches(form, ".wpforms-form")) return "WPForms #" + (form.getAttribute("data-formid") || "");
    if (/^gform_\d+$/.test(form.id)) return "Gravity Forms #" + form.id.slice(6);
    if (matches(form, ".elementor-form")) return "Elementor form";
    return form.id || "Form on " + location.pathname;
  }

  function saveStore() {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(pending));
    } catch (e) {
      /* storage blocked */
    }
  }

  function loadStore() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || "{}");
      for (var k in saved) if (Object.prototype.hasOwnProperty.call(saved, k) && Date.now() - saved[k].ts < MAX_AGE) pending[k] = saved[k];
    } catch (e) {
      /* ignore */
    }
  }

  function remember(form) {
    var t = traitsOf(form);
    if (!t.email && !t.phone) return;
    pending[formKey(form)] = { traits: t, name: formName(form), ts: Date.now() };
    saveStore();
  }

  function send(key, form) {
    var p = pending[key];
    delete pending[key];
    saveStore();
    if (!p && form) p = { traits: traitsOf(form), name: formName(form) };
    if (!p || (!p.traits.email && !p.traits.phone) || !w.adledger) return;
    w.adledger.lead(p.traits, p.name);
  }

  function formFrom(target) {
    if (!target) return null;
    if (target.tagName === "FORM") return target;
    return (target.querySelector && target.querySelector("form")) || (target.closest && target.closest("form")) || null;
  }

  // Classic WooCommerce checkout: fill the hidden visitor id field.
  function fillCheckoutVid() {
    var fields = d.querySelectorAll("input[name='adledger_vid']");
    var vid = fields.length ? visitorId() : "";
    for (var i = 0; i < fields.length; i++) if (vid) fields[i].value = vid;
  }

  // Generic forms with an email field: let the pixel's own data-adledger-lead handler record them.
  function markForms() {
    var forms = d.querySelectorAll("form:not([data-adledger-lead])");
    for (var i = 0; i < forms.length; i++) {
      var f = forms[i];
      if (matches(f, PLUGIN_FORMS) || matches(f, SKIP_FORMS)) continue;
      if (f.querySelector("input[type='email'], input[name*='email' i], input[name*='e-mail' i]")) {
        f.setAttribute("data-adledger-lead", formName(f));
      }
    }
  }

  d.addEventListener(
    "submit",
    function (e) {
      var form = e.target;
      if (!form || form.tagName !== "FORM") return;
      if (form.querySelector("input[name='adledger_vid']")) fillCheckoutVid();
      if (cfg.forms && matches(form, PLUGIN_FORMS)) remember(form);
    },
    true
  );

  if (cfg.forms) {
    // Contact Form 7 (native event, fired on the form or its wrapper).
    d.addEventListener("wpcf7mailsent", function (e) {
      var form = formFrom(e.target);
      if (form) send(formKey(form), form);
    });

    // Page-reload (non-AJAX) Gravity Forms and WPForms confirmations.
    loadStore();
    for (var k in pending) {
      if (!Object.prototype.hasOwnProperty.call(pending, k)) continue;
      var gf = /^gform_(\d+)$/.exec(k);
      var wpf = /^wpforms-form-(\d+)$/.exec(k);
      if (gf && d.querySelector("#gform_confirmation_message_" + gf[1] + ", .gform_confirmation_message_" + gf[1])) send(k, null);
      else if (wpf && d.getElementById("wpforms-confirmation-" + wpf[1])) send(k, null);
    }
  }

  function onReady() {
    fillCheckoutVid();
    var $ = w.jQuery;
    if (cfg.forms && $) {
      // WPForms and Elementor trigger jQuery events on the form element.
      $(d).on("wpformsAjaxSubmitSuccess submit_success", function (e) {
        var form = formFrom(e.target);
        if (form) send(formKey(form), form);
      });
      // Gravity Forms AJAX confirmation.
      $(d).on("gform_confirmation_loaded", function (e, formId) {
        send("gform_" + formId, null);
      });
    }
    // WooCommerce re-renders parts of the checkout.
    if ($) $(d.body).on("updated_checkout", fillCheckoutVid);
    if (cfg.forms) {
      markForms();
      if (w.MutationObserver) {
        var timer = null;
        new MutationObserver(function () {
          if (timer) return;
          timer = setTimeout(function () {
            timer = null;
            markForms();
          }, 500);
        }).observe(d.body, { childList: true, subtree: true });
      }
    }
    // The pixel loads async; try again once it has set the visitor cookie.
    setTimeout(fillCheckoutVid, 2000);
  }

  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", onReady);
  else onReady();
})();
