(function () {
  function t(key, vars) {
    return window.C2CLang.t(key, vars);
  }

  function statusText(status) {
    return t("status_" + status);
  }

  function eventText(status) {
    return t("event_" + status);
  }

  function cvsChainLabel(chain) {
    if (!chain) return "";
    var key = "cvs_" + chain;
    var label = t(key);
    return label === key ? chain : label;
  }

  function fulfillmentLabel(order) {
    if (!order || !order.fulfillment_method) return "—";
    var method = t("fulfill_" + order.fulfillment_method);
    if (order.fulfillment_method === "cvs" && order.cvs_chain) {
      return method + "（" + cvsChainLabel(order.cvs_chain) + "）";
    }
    return method;
  }

  function reasonLabel(prefix, code, text) {
    if (!code) return text || "";
    var label = t(prefix + "_" + code);
    if (code === "other" && text) return label + ": " + text;
    if (text) return label + " — " + text;
    return label;
  }

  function rejectReasonText(order) {
    if (!order || order.status !== "rejected_by_seller") return "";
    return reasonLabel("reject", order.reject_reason_code || "", order.reject_reason_text || "");
  }

  function cancelReasonText(order) {
    if (!order || order.status !== "canceled_by_buyer") return "";
    return reasonLabel("cancel", order.cancel_reason_code || "", order.cancel_reason_text || "");
  }

  var ORDER_SELECT = [
    "id",
    "order_no",
    "buyer_id",
    "seller_id",
    "status",
    "total",
    "items_subtotal",
    "shipping_fee",
    "platform_fee",
    "checkout_group",
    "contact_name",
    "contact_phone",
    "fulfillment_method",
    "fulfillment_detail",
    "cvs_chain",
    "meetup_note_snapshot",
    "payment_method",
    "tracking_no",
    "reject_reason_code",
    "reject_reason_text",
    "cancel_reason_code",
    "cancel_reason_text",
    "payment_confirmed_at",
    "shipped_at",
    "completed_at",
    "created_at",
    "buyer:profiles!orders_buyer_id_fkey(display_name,email)",
    "seller:profiles!orders_seller_id_fkey(display_name,email)",
    "order_items(product_name,unit_price,quantity)",
    "order_events(from_status,to_status,created_at)"
  ].join(",");

  var state = { client: null, session: null, profile: null, roles: [] };

  function rootPrefix() {
    return document.body.getAttribute("data-root") || "";
  }

  function path(rel) {
    var root = rootPrefix();
    return root ? root + "/" + rel : rel;
  }

  function pageName() {
    return document.body.getAttribute("data-page") || "";
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function configured() {
    var cfg = window.C2C_SUPABASE || {};
    if (!cfg.url || !cfg.key) return false;
    if (String(cfg.url).indexOf("YOUR_PROJECT") !== -1) return false;
    if (String(cfg.key).indexOf("YOUR_") === 0) return false;
    return true;
  }

  function errorText(err) {
    var msg = (err && (err.message || err.error_description || err.msg)) || "";
    if (/Invalid login credentials/i.test(msg)) return t("errLogin");
    if (/Email not confirmed/i.test(msg)) return t("errConfirm");
    if (/already registered/i.test(msg)) return t("errExists");
    if (/row-level security/i.test(msg)) return t("errRls");
    if (/JWT|not authenticated/i.test(msg)) return t("errAuth");
    return window.C2CLang.server(msg) || t("errFail");
  }

  function locale() {
    return window.C2CLang.get() === "en" ? "en-US" : "zh-TW";
  }

  function money(value) {
    var number = Number(value || 0);
    return "NT$ " + number.toLocaleString(locale(), { maximumFractionDigits: 2 });
  }

  function when(iso) {
    if (!iso) return "";
    return new Intl.DateTimeFormat(locale(), {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(new Date(iso));
  }

  function monthKey(iso) {
    if (!iso) return "";
    var parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit"
    }).formatToParts(new Date(iso));
    var year = "";
    var month = "";
    parts.forEach(function (part) {
      if (part.type === "year") year = part.value;
      if (part.type === "month") month = part.value;
    });
    return year + "-" + month;
  }

  function monthLabel(key) {
    var bits = String(key || "").split("-");
    if (bits.length < 2) return "";
    if (window.C2CLang.get() === "en") return bits[0] + "-" + bits[1];
    return bits[0] + "年" + Number(bits[1]) + "月";
  }

  function safeUrl(url) {
    var value = String(url || "").trim();
    return /^https?:\/\//i.test(value) ? value : "";
  }

  function safeNext(value) {
    if (!value || value.charAt(0) !== "/") return "";
    if (value.indexOf("//") !== -1 || value.indexOf("\\") !== -1) return "";
    return value;
  }

  function userId() {
    return state.session && state.session.user ? state.session.user.id : "";
  }

  function mode() {
    var saved = "";
    try { saved = localStorage.getItem("c2c-mode") || ""; } catch (e) { saved = ""; }
    if (state.roles.indexOf(saved) >= 0) return saved;
    if (state.roles.indexOf("buyer") >= 0) return "buyer";
    return state.roles[0] || "";
  }

  function flash(message, kind) {
    var el = document.getElementById("flash");
    if (!el) return;
    el.hidden = !message;
    el.className = "flash " + (kind || "ok");
    el.textContent = message || "";
  }

  var seedEn = {
    "二手微積分課本": "Used Calculus Textbook",
    "九成新藍牙耳機": "Like-new Bluetooth Earbuds",
    "可調光桌燈": "Dimmable Desk Lamp",
    "不鏽鋼保溫杯": "Stainless Steel Tumbler",
    "折疊抗風傘": "Folding Windproof Umbrella",
    "機械鍵盤（紅軸）": "Mechanical Keyboard (Red Switches)",
    "統計學講義整理本": "Statistics Notes Binder",
    "迷你電風扇": "Mini USB Fan",
    "帆布托特包": "Canvas Tote Bag",
    "無線滑鼠": "Wireless Mouse",
    "書籍": "Books",
    "生活": "Daily goods",
    "配件": "Accessories",
    "3C": "Electronics",
    "上學期用過，封面有輕微摺痕，內頁乾淨、無缺頁。": "Used last semester. The cover has a light crease; pages are clean with nothing missing.",
    "使用約半年，充電盒與耳機都在，音量與連線正常。": "Used for about half a year. Case and earbuds included; volume and connection work.",
    "三段亮度都能用，燈臂可折，適合宿舍閱讀。": "All three brightness levels work, and the arm folds. Good for dorm reading.",
    "容量 480ml，杯身有使用痕跡，保溫仍正常，已清洗。": "480 ml. Some wear on the body, but it still keeps drinks hot. Washed.",
    "淺色折疊傘，骨架完好、開合順。傘布有一處小污漬。": "Light folding umbrella. Ribs intact, opens smoothly. One small stain on the fabric.",
    "鍵帽完整、軸體手感正常，附原廠線。外殼有輕微磨損。": "All keycaps present, switches feel fine, cable included. Light wear on the case.",
    "含重點標註與練習題解答整理，適合期末複習。": "Highlighted notes and practice answers. Handy for finals review.",
    "USB 供電，兩段風速，夏天宿舍必備。運作正常。": "USB powered with two speeds. Works well for summer dorms.",
    "米白色帆布包，可裝筆電與課本。內側有淺色使用痕跡。": "Off-white canvas tote for a laptop and books. Light wear inside.",
    "2.4G 接收器齊全，感測靈敏，電池蓋有輕微刮痕。": "2.4G receiver included. Tracks smoothly; light scratch on the battery cover."
  };
  var trCache = null;

  function hasCjk(text) {
    return /[\u3400-\u9fff]/.test(String(text || ""));
  }

  function loadTr() {
    if (trCache) return trCache;
    var stored = {};
    try { stored = JSON.parse(localStorage.getItem("c2c-tr") || "{}") || {}; } catch (e) { stored = {}; }
    trCache = Object.assign({}, stored, seedEn);
    return trCache;
  }

  function shown(text) {
    var value = String(text == null ? "" : text);
    if (window.C2CLang.get() !== "en" || !value) return value;
    var hit = loadTr()[value];
    return hit || value;
  }

  function gloss(text) {
    var value = String(text == null ? "" : text);
    return loadTr()[value] || "";
  }

  function remember(key, value) {
    loadTr()[key] = value;
    try {
      var stored = JSON.parse(localStorage.getItem("c2c-tr") || "{}") || {};
      stored[key] = value;
      localStorage.setItem("c2c-tr", JSON.stringify(stored));
    } catch (e) {}
  }

  async function translateOne(text) {
    var res = await fetch("https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text.slice(0, 450)) + "&langpair=zh-TW|en");
    if (!res.ok) throw new Error("translate");
    var data = await res.json();
    var out = data && data.responseData && data.responseData.translatedText;
    if (!out || out === text || /MYMEMORY WARNING|QUERY LENGTH|INVALID/i.test(out)) throw new Error("translate");
    return out;
  }

  async function prepare(texts) {
    if (window.C2CLang.get() !== "en") return;
    var bag = loadTr();
    var pending = [];
    (texts || []).forEach(function (text) {
      var value = String(text || "");
      if (!value || bag[value] || pending.indexOf(value) >= 0) return;
      if (!hasCjk(value)) return;
      pending.push(value);
    });
    for (var i = 0; i < pending.length; i++) {
      try {
        remember(pending[i], await translateOne(pending[i]));
      } catch (e) {}
    }
  }

  function person(record, withEmail) {
    if (!record) return "—";
    var name = shown(record.display_name || "") || "—";
    if (withEmail && record.email) {
      return window.C2CLang.get() === "en" ? name + " (" + record.email + ")" : name + "（" + record.email + "）";
    }
    return name;
  }

  async function loadIdentity() {
    var uid = userId();
    var profileRes = await state.client.from("profiles").select("id, email, display_name, phone, address, created_at").eq("id", uid).maybeSingle();
    var rolesRes = await state.client.from("user_roles").select("role").eq("user_id", uid);
    if (profileRes.error) throw profileRes.error;
    if (rolesRes.error) throw rolesRes.error;
    state.profile = profileRes.data;
    var rank = { buyer: 0, seller: 1, admin: 2 };
    state.roles = (rolesRes.data || []).map(function (row) { return row.role; }).sort(function (a, b) {
      return (rank[a] || 9) - (rank[b] || 9);
    });
  }

  var ICONS = {
    products: '<path d="M4 7.5h16v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-11z"/><path d="M8 7.5V6a4 4 0 0 1 8 0v1.5"/><path d="M9 12h6"/>',
    cart: '<path d="M3.5 5h1.7l1.1 9.2a1.5 1.5 0 0 0 1.5 1.3h8.5a1.5 1.5 0 0 0 1.5-1.2L19.5 8H7"/><circle cx="9.2" cy="19" r="1.2"/><circle cx="16.2" cy="19" r="1.2"/>',
    orders: '<path d="M7 4.5h10a1.5 1.5 0 0 1 1.5 1.5v14l-3-1.5-3 1.5-3-1.5-3 1.5V6A1.5 1.5 0 0 1 7 4.5z"/><path d="M9 9h6M9 12.5h6M9 16h4"/>',
    profile: '<circle cx="12" cy="8" r="3.2"/><path d="M5.5 19.2a6.5 6.5 0 0 1 13 0"/>',
    mine: '<path d="M5 7.5h14v11.5H5z"/><path d="M9 7.5V6a3 3 0 0 1 6 0v1.5"/><path d="M8.5 12.5h7"/>',
    process: '<path d="M4.5 7h15v3.5H4.5zM4.5 13.5h15V17H4.5z"/><circle cx="8" cy="8.5" r="1"/><circle cx="8" cy="15.2" r="1"/>',
    dash: '<path d="M4.5 4.5h6.5v6.5H4.5zM13 4.5h6.5v4H13zM13 11.5h6.5v8H13zM4.5 14h6.5v5.5H4.5z"/>',
    admin: '<path d="M12 3.5 19 7v5.2c0 4.2-2.8 7.4-7 8.8-4.2-1.4-7-4.6-7-8.8V7l7-3.5z"/><path d="M9.5 12.2 11.2 14l3.5-3.8"/>',
    preview: '<circle cx="12" cy="12" r="3"/><path d="M3.5 12S7 6.5 12 6.5 20.5 12 20.5 12 17 17.5 12 17.5 3.5 12 3.5 12z"/>',
    login: '<path d="M10 4.5h7.5v15H10"/><path d="M4.5 12h10"/><path d="M11.5 8.5 15 12l-3.5 3.5"/>',
    register: '<circle cx="12" cy="8" r="3"/><path d="M5.8 19a6.2 6.2 0 0 1 8.7-2.4"/><path d="M16.5 14.5v6M13.5 17.5h6"/>',
    logout: '<path d="M10 4.5H5.5v15H10"/><path d="M10 12h9"/><path d="M15.5 8.5 19 12l-3.5 3.5"/>',
    checkout: '<path d="M5 6.5h14l-1.2 9.5H7.2L5 6.5z"/><path d="M9 16.8V19a1.2 1.2 0 0 0 1.2 1.2h3.6A1.2 1.2 0 0 0 15 19v-2.2"/><path d="M9.5 10.5h5"/>'
  };

  function icon(name) {
    var paths = ICONS[name];
    if (!paths) return "";
    return '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + paths + "</svg>";
  }

  function withIcon(name, label) {
    return icon(name) + '<span>' + esc(label) + "</span>";
  }

  function navIconFor(href) {
    if (href === "cart.html") return "cart";
    if (href === "buyer/orders.html") return "orders";
    if (href === "seller/orders.html") return "process";
    if (href === "profile.html") return "profile";
    if (href === "seller/products.html") return "mine";
    if (href === "seller/dashboard.html") return "dash";
    if (href === "admin/transactions.html") return "admin";
    if (href === "index.html") {
      if (mode() === "seller" || mode() === "admin") return "preview";
      return "products";
    }
    return "products";
  }

  function navItems() {
    var current = pageName();
    var items;
    if (!state.session) {
      items = [
        ["index.html", t("navProducts"), "home product"]
      ];
    } else if (mode() === "seller") {
      items = [
        ["seller/products.html", t("navMine"), "seller-products"],
        ["seller/orders.html", t("navProcess"), "seller-orders"],
        ["seller/dashboard.html", t("navDash"), "seller-dashboard"],
        ["profile.html", t("navProfile"), "profile"],
        ["index.html", t("navPreview"), "home product"]
      ];
    } else if (mode() === "admin") {
      items = [
        ["admin/transactions.html", t("navAdmin"), "admin"],
        ["profile.html", t("navProfile"), "profile"],
        ["index.html", t("navPreview"), "home product"]
      ];
    } else {
      items = [
        ["index.html", t("navProducts"), "home product"],
        ["cart.html", t("navCart"), "cart"],
        ["buyer/orders.html", t("navOrders"), "buyer-orders"],
        ["profile.html", t("navProfile"), "profile"]
      ];
    }
    return items.map(function (item) {
      var currentClass = item[2].split(" ").indexOf(current) >= 0 ? " current" : "";
      var cart = item[0] === "cart.html" ? ' <span id="cart-count" class="count" hidden></span>' : "";
      return '<a class="nav-link' + currentClass + '" href="' + esc(path(item[0])) + '">' + withIcon(navIconFor(item[0]), item[1]) + cart + "</a>";
    }).join("");
  }

  function roleLabel(role) {
    if (role === "seller") return t("sellerMode");
    if (role === "admin") return t("adminMode");
    return t("buyerMode");
  }

  function renderChrome() {
    var top = document.getElementById("top");
    if (!top) return;
    var titles = {
      home: "titleHome",
      product: "titleProduct",
      login: "titleLogin",
      register: "titleRegister",
      cart: "titleCart",
      "buyer-orders": "titleOrders",
      "seller-products": "titleMine",
      "seller-orders": "titleProcess",
      "seller-dashboard": "titleDash",
      admin: "titleAdmin",
      profile: "titleProfile"
    };
    document.title = t(titles[pageName()] || "titleHome");
    var account = "";
    if (state.session) {
      var name = (state.profile && state.profile.display_name) || state.session.user.email || "";
      var switcher = "";
      if (state.roles.length > 1) {
        switcher = '<label class="who">' + esc(t("mode")) + ' <select id="mode-switch">' + state.roles.map(function (role) {
          return '<option value="' + role + '"' + (mode() === role ? " selected" : "") + ">" + esc(roleLabel(role)) + "</option>";
        }).join("") + "</select></label>";
      } else if (state.roles.length === 1) {
        switcher = '<span class="who">' + esc(roleLabel(state.roles[0])) + "</span>";
      }
      account = '<div class="account"><a class="who profile-link" href="' + esc(path("profile.html")) + '">' + withIcon("profile", name) + "</a>" + switcher + '<button class="btn ghost btn-icon" id="sign-out" type="button">' + withIcon("logout", t("logout")) + "</button></div>";
    } else {
      account = '<div class="util-links"><a class="util-link" href="' + esc(path("register.html")) + '">' + withIcon("register", t("navRegister")) + '</a><a class="util-link" href="' + esc(path("login.html")) + '">' + withIcon("login", t("navLogin")) + "</a></div>";
    }
    var currentLang = window.C2CLang.get();
    var langSwitch = '<span class="lang"><button type="button" data-lang="zh"' + (currentLang === "zh" ? ' aria-current="true"' : "") + '>中文</button><span>|</span><button type="button" data-lang="en"' + (currentLang === "en" ? ' aria-current="true"' : "") + ">EN</button></span>";
    var setup = "";
    if (!configured()) {
      setup = '<section class="setup"><h2>' + esc(t("setupTitle")) + "</h2><ol><li>" + esc(t("setup1")) + "</li><li>" + esc(t("setup2")) + "</li><li>" + esc(t("setup3")) + "</li><li>" + esc(t("setup4")) + "</li><li>" + esc(t("setup5")) + "</li></ol></section>";
    }
    var demo = '<div class="demo-bar"><details><summary>' + esc(t("demo")) + "</summary><ol><li>" + esc(t("demo1")) + "</li><li>" + esc(t("demo2")) + "</li><li>" + esc(t("demo3")) + "</li><li>" + esc(t("demo4")) + "</li><li>" + esc(t("demo5")) + "</li></ol></details></div>";
    top.innerHTML = demo +
      '<div class="shell"><a class="brand" href="' + esc(path("index.html")) + '">' + esc(t("brand")) + "<span>" + esc(t("brandSub")) + '</span></a><nav class="nav">' + navItems() + '</nav><div class="tools">' + langSwitch + account + "</div></div>" +
      '<div id="flash-slot"><p id="flash" class="flash" hidden></p></div>' + setup;

    var select = document.getElementById("mode-switch");
    if (select) {
      select.addEventListener("change", function () {
        try { localStorage.setItem("c2c-mode", select.value); } catch (e) {}
        var dest = select.value === "seller" ? "seller/products.html" : select.value === "admin" ? "admin/transactions.html" : "index.html";
        location.href = path(dest);
      });
    }
    var signOut = document.getElementById("sign-out");
    if (signOut) {
      signOut.addEventListener("click", async function () {
        if (state.client) await state.client.auth.signOut();
        location.href = path("index.html");
      });
    }
    top.querySelectorAll("[data-lang]").forEach(function (button) {
      button.addEventListener("click", function () {
        try { localStorage.setItem("c2c-lang", button.getAttribute("data-lang")); } catch (e) {}
        location.reload();
      });
    });
    var foot = document.getElementById("foot");
    if (!foot) {
      foot = document.createElement("footer");
      foot.id = "foot";
      document.body.appendChild(foot);
    }
    foot.innerHTML = '<div class="foot-inner"><strong>' + esc(t("footerTitle")) + "</strong><p>" + esc(t("footerBody")) + "</p></div>";
    refreshCartCount().catch(function () {});
  }

  async function refreshCartCount() {
    var el = document.getElementById("cart-count");
    if (!el || !state.client || !state.session || state.roles.indexOf("buyer") < 0) return;
    var res = await state.client.from("cart_items").select("quantity").eq("user_id", userId());
    if (res.error || !res.data) return;
    var count = res.data.reduce(function (sum, row) { return sum + Number(row.quantity || 0); }, 0);
    el.hidden = count <= 0;
    el.textContent = count > 0 ? String(count) : "";
  }

  function alignMode(expected) {
    if (state.roles.indexOf(expected) < 0 || mode() === expected) return;
    try { localStorage.setItem("c2c-mode", expected); } catch (e) {}
    renderChrome();
  }

  function guard(role) {
    var app = document.getElementById("app");
    if (!configured()) {
      app.innerHTML = '<section class="panel"><h1>' + esc(t("offline")) + "</h1><p>" + esc(t("offlineBody")) + "</p></section>";
      return false;
    }
    if (!state.session) {
      var next = encodeURIComponent(location.pathname + location.search);
      app.innerHTML = '<section class="panel"><h1>' + esc(t("pleaseLogin")) + '</h1><p><a class="btn" href="' + esc(path("login.html")) + "?next=" + next + '">' + esc(t("goLogin")) + "</a></p></section>";
      return false;
    }
    if (role && state.roles.indexOf(role) < 0) {
      var names = state.roles.map(roleLabel).join(window.C2CLang.get() === "en" ? ", " : "、");
      app.innerHTML = '<section class="panel"><h1>' + esc(t("noRole")) + "</h1><p>" + esc(t("rolesNow", { roles: names || t("noneRole") })) + "</p><p>" + esc(t("roleHelp")) + "</p></section>";
      return false;
    }
    return true;
  }

  async function fetchOrders(scope, filters) {
    filters = filters || {};
    if (scope === "admin" && state.roles.indexOf("admin") < 0) {
      throw new Error(t("noAdmin"));
    }
    var query = state.client.from("orders").select(ORDER_SELECT).order("created_at", { ascending: false });
    if (scope === "buyer") query = query.eq("buyer_id", userId());
    if (scope === "seller") query = query.eq("seller_id", userId());
    if (scope === "admin" && filters.orderNo) {
      var term = String(filters.orderNo).replace(/[%_]/g, "").trim();
      if (term) query = query.ilike("order_no", "%" + term + "%");
    }
    if (scope === "admin" && filters.status === "incomplete") {
      query = query.in("status", ["pending_payment", "ready_to_ship", "shipped"]);
    } else if (scope === "admin" && filters.status) {
      query = query.eq("status", filters.status);
    }
    var res = await query;
    if (res.error) throw res.error;
    var texts = [];
    (res.data || []).forEach(function (order) {
      (order.order_items || []).forEach(function (item) { texts.push(item.product_name); });
      if (order.buyer) texts.push(order.buyer.display_name);
      if (order.seller) texts.push(order.seller.display_name);
    });
    await prepare(texts);
    return res.data || [];
  }

  function orderArticle(order, options) {
    options = options || {};
    var events = (order.order_events || []).slice().sort(function (a, b) {
      return String(a.created_at).localeCompare(String(b.created_at));
    });
    var items = (order.order_items || []).map(function (item) {
      return "<li>" + esc(t("lineItem", { name: shown(item.product_name), qty: item.quantity, price: money(item.unit_price) })) + "</li>";
    }).join("");
    var timeline = events.map(function (event) {
      return "<li>" + esc(when(event.created_at)) + "　" + esc(eventText(event.to_status)) + "</li>";
    }).join("");
    var party = "";
    if (options.who === "seller") party = "<p>" + esc(t("partyBuyer", { name: person(order.buyer, true) })) + "</p>";
    if (options.who === "buyer") party = "<p>" + esc(t("partySeller", { name: person(order.seller, false) })) + "</p>";
    if (options.who === "admin") party = "<p>" + esc(t("partyBuyer", { name: person(order.buyer, true) })) + "　" + esc(t("partySeller", { name: person(order.seller, true) })) + "</p>";
    var action = "";
    if (options.who === "seller" && options.actions) {
      if (order.status === "pending_payment") {
        action = '<button class="btn" type="button" data-rpc="seller_confirm_payment" data-id="' + esc(order.id) + '">' + esc(t("confirmPay")) + "</button>" +
          '<button class="btn ghost" type="button" data-reject="' + esc(order.id) + '">' + esc(t("rejectOrder")) + "</button>";
      } else if (order.status === "ready_to_ship") {
        action = '<label class="field grow">' + esc(t("trackingNo")) + '<input data-tracking="' + esc(order.id) + '" maxlength="80" placeholder="' + esc(t("trackingPh")) + '"></label>' +
          '<button class="btn" type="button" data-rpc="seller_confirm_shipment" data-id="' + esc(order.id) + '">' + esc(t("confirmShip")) + "</button>";
      }
    }
    if (options.who === "buyer" && options.actions) {
      if (order.status === "pending_payment") {
        action = '<button class="btn ghost" type="button" data-cancel="' + esc(order.id) + '">' + esc(t("cancelOrder")) + "</button>";
      } else if (order.status === "shipped") {
        action = '<button class="btn" type="button" data-rpc="buyer_complete_order" data-id="' + esc(order.id) + '">' + esc(t("complete")) + "</button>";
      }
    }
    var method = fulfillmentLabel(order);
    var handoff = "<div class=\"fee-box\">" +
      "<p>" + esc(t("itemsSubtotal")) + " <strong>" + esc(money(order.items_subtotal != null ? order.items_subtotal : order.total)) + "</strong></p>" +
      "<p>" + esc(t("shippingFee")) + " <strong>" + esc(money(order.shipping_fee || 0)) + "</strong></p>" +
      "<p>" + esc(t("platformFee")) + " <strong>" + esc(money(order.platform_fee || 0)) + "</strong></p>" +
      "<p class=\"price\">" + esc(t("orderTotal")) + " " + esc(money(order.total)) + "</p></div>";
    if (order.fulfillment_method === "home" || order.fulfillment_method === "delivery" || order.fulfillment_method === "cvs") {
      handoff += "<p>" + esc(t("contactLine", { name: order.contact_name || "—", phone: order.contact_phone || "—" })) + "<br>" +
        esc(t("fulfillmentLine", { method: method, detail: order.fulfillment_detail || "—" })) +
        (order.tracking_no ? "<br>" + esc(t("trackingLine", { no: order.tracking_no })) : "") + "</p>";
    } else if (order.fulfillment_method === "meetup") {
      handoff += "<p>" + esc(t("fulfillmentLine", { method: method, detail: order.meetup_note_snapshot || order.fulfillment_detail || "—" })) + "</p>";
    }
    var reject = rejectReasonText(order);
    if (reject) handoff += '<p class="hint">' + esc(t("rejectReasonLine", { reason: reject })) + "</p>";
    var cancel = cancelReasonText(order);
    if (cancel) handoff += '<p class="hint">' + esc(t("cancelReasonLine", { reason: cancel })) + "</p>";
    var acceptNote = options.who === "seller" && order.status === "pending_payment"
      ? '<p class="hint">' + esc(t("acceptHint")) + "</p>"
      : "";
    var rejectForm = options.who === "seller" && options.actions && order.status === "pending_payment"
      ? '<form class="reject-form" data-reject-form="' + esc(order.id) + '" hidden>' +
        '<label class="field">' + esc(t("rejectReason")) + '<select name="reason_code" required>' +
        '<option value="">' + esc(t("choose")) + "</option>" +
        '<option value="unavailable">' + esc(t("reject_unavailable")) + "</option>" +
        '<option value="condition_changed">' + esc(t("reject_condition_changed")) + "</option>" +
        '<option value="cannot_deliver">' + esc(t("reject_cannot_deliver")) + "</option>" +
        '<option value="listing_error">' + esc(t("reject_listing_error")) + "</option>" +
        '<option value="other">' + esc(t("reject_other")) + "</option>" +
        "</select></label>" +
        '<label class="field">' + esc(t("rejectOtherDetail")) + '<textarea name="reason_text" maxlength="200"></textarea></label>' +
        '<p class="hint">' + esc(t("rejectBuyerSees")) + "</p>" +
        '<button class="btn" type="submit">' + esc(t("submitReject")) + "</button></form>"
      : "";
    var cancelForm = options.who === "buyer" && options.actions && order.status === "pending_payment"
      ? '<form class="reject-form" data-cancel-form="' + esc(order.id) + '" hidden>' +
        '<label class="field">' + esc(t("cancelReason")) + '<select name="reason_code" required>' +
        '<option value="">' + esc(t("choose")) + "</option>" +
        '<option value="changed_mind">' + esc(t("cancel_changed_mind")) + "</option>" +
        '<option value="ordered_wrong">' + esc(t("cancel_ordered_wrong")) + "</option>" +
        '<option value="shipping_fee">' + esc(t("cancel_shipping_fee")) + "</option>" +
        '<option value="wait_too_long">' + esc(t("cancel_wait_too_long")) + "</option>" +
        '<option value="other">' + esc(t("cancel_other")) + "</option>" +
        "</select></label>" +
        '<label class="field">' + esc(t("cancelOtherDetail")) + '<textarea name="reason_text" maxlength="200"></textarea></label>' +
        '<p class="hint">' + esc(t("cancelSellerSees")) + "</p>" +
        '<button class="btn" type="submit">' + esc(t("submitCancel")) + "</button></form>"
      : "";
    return '<article class="order"><div class="spread"><h3>' + esc(order.order_no) + '</h3><span class="badge ' + esc(order.status) + '">' + esc(statusText(order.status, order)) + '</span></div>' +
      party +
      "<p>" + esc(t("moneyLine", { money: money(order.total), time: when(order.created_at) || "—" })) + "</p>" +
      handoff +
      '<ul class="items">' + items + "</ul>" +
      '<ol class="timeline">' + timeline + "</ol>" +
      acceptNote +
      (action ? '<p class="row">' + action + "</p>" : "") +
      rejectForm +
      cancelForm +
      "</article>";
  }

  function bindOrderActions(container, onDone) {
    container.addEventListener("click", async function (event) {
      var rejectBtn = event.target.closest("[data-reject]");
      if (rejectBtn) {
        var rejectForm = container.querySelector('[data-reject-form="' + rejectBtn.getAttribute("data-reject") + '"]');
        if (rejectForm) rejectForm.hidden = !rejectForm.hidden;
        return;
      }
      var cancelBtn = event.target.closest("[data-cancel]");
      if (cancelBtn) {
        var cancelForm = container.querySelector('[data-cancel-form="' + cancelBtn.getAttribute("data-cancel") + '"]');
        if (cancelForm) cancelForm.hidden = !cancelForm.hidden;
        return;
      }
      var button = event.target.closest("[data-rpc]");
      if (!button) return;
      if (!window.confirm(t("confirmDo", { action: button.textContent }))) return;
      button.disabled = true;
      var rpc = button.getAttribute("data-rpc");
      var args = { target_order: button.getAttribute("data-id") };
      if (rpc === "seller_confirm_shipment") {
        var track = container.querySelector('[data-tracking="' + button.getAttribute("data-id") + '"]');
        args.tracking_no = track ? track.value.trim() : "";
      }
      var res = await state.client.rpc(rpc, args);
      if (res.error) {
        button.disabled = false;
        flash(errorText(res.error), "bad");
        return;
      }
      flash(t("orderUpdated"));
      await onDone();
    });
    container.addEventListener("submit", async function (event) {
      var rejectForm = event.target.closest("[data-reject-form]");
      var cancelForm = event.target.closest("[data-cancel-form]");
      var form = rejectForm || cancelForm;
      if (!form) return;
      event.preventDefault();
      var code = form.elements.reason_code.value;
      var text = form.elements.reason_text.value.trim();
      var isCancel = !!cancelForm;
      if (!code) {
        flash(t(isCancel ? "needCancelReason" : "needRejectReason"), "bad");
        return;
      }
      if (code === "other" && text.length < 2) {
        flash(t(isCancel ? "needCancelOther" : "needRejectOther"), "bad");
        return;
      }
      if (!window.confirm(t("confirmDo", { action: t(isCancel ? "cancelOrder" : "rejectOrder") }))) return;
      var btn = form.querySelector("button");
      btn.disabled = true;
      var res = await state.client.rpc(isCancel ? "buyer_cancel_order" : "seller_reject_order", {
        target_order: form.getAttribute(isCancel ? "data-cancel-form" : "data-reject-form"),
        reason_code: code,
        reason_text: text
      });
      if (res.error) {
        btn.disabled = false;
        flash(errorText(res.error), "bad");
        return;
      }
      flash(t("orderUpdated"));
      await onDone();
    });
  }

  async function uploadProductImage(file) {
    if (!file) return "";
    var okType = /^(image\/jpeg|image\/png|image\/webp|image\/gif)$/i.test(file.type);
    if (!okType || file.size > 3145728) {
      throw new Error(t("badImage"));
    }
    var ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (["jpg", "jpeg", "png", "webp", "gif"].indexOf(ext) < 0) ext = "jpg";
    var path = userId() + "/" + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())) + "." + ext;
    var uploaded = await state.client.storage.from("product-images").upload(path, file, {
      upsert: false,
      contentType: file.type
    });
    if (uploaded.error) throw uploaded.error;
    var pub = state.client.storage.from("product-images").getPublicUrl(path);
    return (pub && pub.data && pub.data.publicUrl) || "";
  }

  function csvCell(value) {
    var text = value == null ? "" : String(value);
    if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function downloadCsv(filename, orders) {
    var mine = (orders || []).filter(function (order) { return order.seller_id === userId(); });
    var lines = [[t("csvNo"), t("csvTime"), t("csvBuyer"), t("csvStatus"), t("csvAmount"), t("csvPay"), t("csvShip"), t("csvDone"), t("csvContact"), t("csvPhone"), t("csvFulfill"), t("csvPlace"), t("csvPayMethod"), t("csvItems")].join(",")];
    mine.forEach(function (order) {
      var items = (order.order_items || []).map(function (item) {
        return shown(item.product_name) + " x" + item.quantity;
      }).join(window.C2CLang.get() === "en" ? "; " : "；");
      var buyer = person(order.buyer, true);
      lines.push([
        order.order_no,
        when(order.created_at),
        buyer,
        statusText(order.status),
        order.total,
        when(order.payment_confirmed_at),
        when(order.shipped_at),
        when(order.completed_at),
        order.contact_name || "",
        order.contact_phone || "",
        order.fulfillment_method ? fulfillmentLabel(order) : "",
        order.fulfillment_detail || "",
        order.payment_method ? t("pay_" + order.payment_method) : "",
        items
      ].map(csvCell).join(","));
    });
    var blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function boot() {
    if (window.supabase && configured()) {
      state.client = window.supabase.createClient(window.C2C_SUPABASE.url, window.C2C_SUPABASE.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      var sessionRes = await state.client.auth.getSession();
      if (sessionRes.error) throw sessionRes.error;
      state.session = sessionRes.data.session;
      if (state.session) await loadIdentity();
    }
    renderChrome();
  }

  window.C2C = {
    state: state,
    path: path,
    esc: esc,
    configured: configured,
    errorText: errorText,
    money: money,
    when: when,
    monthKey: monthKey,
    monthLabel: monthLabel,
    safeUrl: safeUrl,
    safeNext: safeNext,
    flash: flash,
    guard: guard,
    alignMode: alignMode,
    fetchOrders: fetchOrders,
    orderArticle: orderArticle,
    bindOrderActions: bindOrderActions,
    bindSellerActions: bindOrderActions,
    uploadProductImage: uploadProductImage,
    downloadCsv: downloadCsv,
    refreshCartCount: refreshCartCount,
    renderChrome: renderChrome,
    userId: userId,
    mode: mode,
    t: t,
    statusText: statusText,
    shown: shown,
    gloss: gloss,
    prepare: prepare,
    icon: icon,
    withIcon: withIcon
  };

  document.addEventListener("DOMContentLoaded", function () {
    boot().then(function () {
      if (typeof window.C2CPage === "function") return window.C2CPage();
    }).catch(function (err) {
      renderChrome();
      flash(errorText(err), "bad");
      var app = document.getElementById("app");
      if (app) app.innerHTML = '<section class="panel"><h1>' + esc(t("connectFail")) + "</h1><p>" + esc(errorText(err)) + "</p></section>";
    });
  });
})();
