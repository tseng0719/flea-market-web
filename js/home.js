window.C2CPage = async function () {
  var app = document.getElementById("app");
  var t = C2C.t;
  if (!C2C.configured()) {
    app.innerHTML = '<section class="panel"><h1>' + C2C.esc(t("needConfigTitle")) + "</h1><p>" + C2C.esc(t("needConfigBody")) + "</p></section>";
    return;
  }
  var res = await C2C.state.client
    .from("products")
    .select("id, name, category, description, price, quantity, image_url, created_at, seller:profiles!products_seller_id_fkey(display_name)")
    .eq("listing_status", "active")
    .order("created_at", { ascending: false });
  if (res.error) throw res.error;
  var rows = res.data || [];
  var texts = [];
  rows.forEach(function (product) {
    texts.push(product.name, product.category, product.description);
    if (product.seller) texts.push(product.seller.display_name);
  });
  await C2C.prepare(texts);

  var params = new URLSearchParams(location.search);
  var state = {
    q: (params.get("q") || "").trim(),
    cat: params.get("cat") || "",
    min: params.get("min") || "",
    max: params.get("max") || "",
    stock: params.get("stock") === "1",
    sort: params.get("sort") || "newest",
    filtersOpen: false,
    priceError: false,
    searchTimer: null
  };
  if (["newest", "priceAsc", "priceDesc"].indexOf(state.sort) < 0) state.sort = "newest";

  function parsePrice(value) {
    if (value === "" || value == null) return null;
    var n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  }

  function priceBounds() {
    var min = parsePrice(state.min);
    var max = parsePrice(state.max);
    var invalid = min != null && max != null && min > max;
    return { min: min, max: max, invalid: invalid };
  }

  function categories() {
    var map = {};
    rows.forEach(function (product) {
      var raw = (product.category || "").trim();
      var key = raw || "__none__";
      if (!map[key]) {
        map[key] = {
          key: key,
          label: raw ? C2C.shown(raw) : t("uncategorized"),
          count: 0
        };
      }
      map[key].count += 1;
    });
    return Object.keys(map).map(function (key) { return map[key]; }).sort(function (a, b) {
      return a.label.localeCompare(b.label, window.C2CLang.get() === "en" ? "en" : "zh-Hant");
    });
  }

  function filtered() {
    var bounds = priceBounds();
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (product) {
      var rawCat = (product.category || "").trim();
      if (state.cat === "__none__" && rawCat) return false;
      if (state.cat && state.cat !== "__none__" && rawCat !== state.cat) return false;
      if (state.stock && !(Number(product.quantity) > 0)) return false;
      if (!bounds.invalid) {
        var price = Number(product.price);
        if (bounds.min != null && price < bounds.min) return false;
        if (bounds.max != null && price > bounds.max) return false;
      }
      if (!q) return true;
      var blob = [
        product.name,
        product.category,
        product.description,
        C2C.shown(product.name),
        C2C.shown(product.category),
        C2C.shown(product.description),
        C2C.gloss(product.name),
        C2C.gloss(product.category),
        C2C.gloss(product.description)
      ].join(" ").toLowerCase();
      return blob.indexOf(q) >= 0;
    });
    list.sort(function (a, b) {
      if (state.sort === "priceAsc") return Number(a.price) - Number(b.price);
      if (state.sort === "priceDesc") return Number(b.price) - Number(a.price);
      return String(b.created_at).localeCompare(String(a.created_at));
    });
    return list;
  }

  function syncUrl() {
    var bounds = priceBounds();
    var next = new URLSearchParams();
    if (state.q.trim()) next.set("q", state.q.trim());
    if (state.cat) next.set("cat", state.cat);
    if (!bounds.invalid) {
      if (state.min !== "") next.set("min", state.min);
      if (state.max !== "") next.set("max", state.max);
    }
    if (state.stock) next.set("stock", "1");
    if (state.sort && state.sort !== "newest") next.set("sort", state.sort);
    var query = next.toString();
    var url = location.pathname + (query ? "?" + query : "") + location.hash;
    try { history.replaceState(null, "", url); } catch (e) {}
  }

  function cardHtml(product) {
    var name = C2C.shown(product.name);
    var category = C2C.shown(product.category || t("uncategorized"));
    var image = C2C.safeUrl(product.image_url);
    var media = image
      ? '<img src="' + C2C.esc(image) + '" alt="' + C2C.esc(name) + '">'
      : '<div class="thumb">' + C2C.esc((name || "·").slice(0, 1)) + "</div>";
    var sellerName = product.seller && product.seller.display_name ? C2C.shown(product.seller.display_name) : t("sellerWord");
    var stock = Number(product.quantity) > 0 ? t("stockLeft", { n: product.quantity }) : t("soldOut");
    var href = C2C.path("product.html?id=" + product.id);
    return '<article class="card"><a class="card-link" href="' + C2C.esc(href) + '">' + media +
      '<div class="body"><h2 class="title">' + C2C.esc(name) + '</h2><p class="price">' + C2C.esc(C2C.money(product.price)) + '</p><p class="hint">' + C2C.esc(category) + "　" + C2C.esc(stock) + '</p><p class="shop">' + C2C.esc(sellerName) + "</p></div></a></article>";
  }

  function catsHtml() {
    var cats = categories();
    var html = '<button type="button" class="home-cat' + (!state.cat ? " active" : "") + '" data-cat="">' + C2C.esc(t("allCategories")) + "</button>";
    html += cats.map(function (item) {
      return '<button type="button" class="home-cat' + (state.cat === item.key ? " active" : "") + '" data-cat="' + C2C.esc(item.key) + '">' +
        C2C.esc(item.label) + "</button>";
    }).join("");
    return html;
  }

  function chipsHtml() {
    var chips = [];
    if (state.q.trim()) {
      chips.push({ key: "q", label: t("chipSearch", { q: state.q.trim() }) });
    }
    if (state.cat) {
      var label = state.cat === "__none__" ? t("uncategorized") : C2C.shown(state.cat);
      chips.push({ key: "cat", label: label });
    }
    var bounds = priceBounds();
    if (!bounds.invalid && state.min !== "" && bounds.min != null) {
      chips.push({ key: "min", label: t("chipMin", { n: bounds.min }) });
    }
    if (!bounds.invalid && state.max !== "" && bounds.max != null) {
      chips.push({ key: "max", label: t("chipMax", { n: bounds.max }) });
    }
    if (state.stock) {
      chips.push({ key: "stock", label: t("chipStock") });
    }
    if (!chips.length) return "";
    return '<div class="filter-chips">' + chips.map(function (chip) {
      return '<button type="button" class="filter-chip" data-clear="' + C2C.esc(chip.key) + '">' +
        C2C.esc(chip.label) + '<span aria-label="' + C2C.esc(t("clearChip")) + '">×</span></button>';
    }).join("") + "</div>";
  }

  function filterPanelHtml() {
    var bounds = priceBounds();
    var err = bounds.invalid ? '<p class="field-hint bad">' + C2C.esc(t("priceRangeHint")) + "</p>" : "";
    return '<div class="filter-panel' + (state.filtersOpen ? " open" : "") + '" id="filter-panel">' +
      '<div class="filter-panel-grid">' +
      '<label class="field">' + C2C.esc(t("minPrice")) + ' (NT$)<input name="min" type="number" min="0" step="1" inputmode="decimal" value="' + C2C.esc(state.min) + '"></label>' +
      '<label class="field">' + C2C.esc(t("maxPrice")) + ' (NT$)<input name="max" type="number" min="0" step="1" inputmode="decimal" value="' + C2C.esc(state.max) + '"></label>' +
      "</div>" + err +
      '<label class="check"><input name="stock" type="checkbox"' + (state.stock ? " checked" : "") + "> " + C2C.esc(t("inStockOnly")) + "</label>" +
      '<div class="row"><button class="btn" type="button" id="apply-filters">' + C2C.esc(t("applyFilters")) + "</button></div>" +
      "</div>";
  }

  function toolbarHtml() {
    return '<section class="home-filter" id="home-filter">' +
      '<div class="home-toolbar">' +
      '<label class="home-search field grow"><span class="sr-only">' + C2C.esc(t("search")) + '</span>' +
      '<input id="home-q" name="q" value="' + C2C.esc(state.q) + '" placeholder="' + C2C.esc(t("searchPh")) + '" autocomplete="off"></label>' +
      '<div class="filter-wrap">' +
      '<button type="button" class="btn ghost' + (state.filtersOpen ? " active" : "") + '" id="toggle-filters">' + C2C.esc(t("filters")) + "</button>" +
      filterPanelHtml() +
      "</div>" +
      '<label class="field home-sort"><span>' + C2C.esc(t("sortBy")) + "</span>" +
      '<select id="home-sort">' +
      '<option value="newest"' + (state.sort === "newest" ? " selected" : "") + ">" + C2C.esc(t("sortNewest")) + "</option>" +
      '<option value="priceAsc"' + (state.sort === "priceAsc" ? " selected" : "") + ">" + C2C.esc(t("sortPriceAsc")) + "</option>" +
      '<option value="priceDesc"' + (state.sort === "priceDesc" ? " selected" : "") + ">" + C2C.esc(t("sortPriceDesc")) + "</option>" +
      "</select></label>" +
      "</div>" +
      '<div class="home-cats" aria-label="' + C2C.esc(t("category")) + '">' + catsHtml() + "</div>" +
      "</section>";
  }

  function listHtml() {
    var products = filtered();
    var cards = products.map(cardHtml).join("");
    var empty = (state.q.trim() || state.cat || state.min !== "" || state.max !== "" || state.stock)
      ? '<section class="panel"><h2>' + C2C.esc(t("noMatch")) + "</h2></section>"
      : '<section class="panel"><h2>' + C2C.esc(t("emptyTitle")) + "</h2><p>" + C2C.esc(t("emptyBody")) + "</p></section>";
    return '<div class="result-meta" id="listings">' +
      '<p class="result-count">' + C2C.esc(t("showingResults", { n: products.length })) + "</p>" +
      chipsHtml() +
      "</div>" +
      '<p class="lead">' + C2C.esc(t("lead")) + "</p>" +
      (cards ? '<div class="grid">' + cards + "</div>" : empty);
  }

  function bindImages(root) {
    if (!root) return;
    root.querySelectorAll("img").forEach(function (img) {
      if (img.classList.contains("hero-photo")) return;
      img.addEventListener("error", function () {
        var fallback = document.createElement("div");
        fallback.className = "thumb";
        fallback.textContent = t("noImage");
        img.replaceWith(fallback);
      });
    });
  }

  function clearChip(key) {
    if (key === "q") state.q = "";
    if (key === "cat") state.cat = "";
    if (key === "min") state.min = "";
    if (key === "max") state.max = "";
    if (key === "stock") state.stock = false;
  }

  function bindFilterUi() {
    var qInput = document.getElementById("home-q");
    if (qInput) {
      qInput.addEventListener("input", function () {
        state.q = qInput.value;
        clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(function () {
          syncUrl();
          refreshList();
        }, 160);
      });
    }

    var sort = document.getElementById("home-sort");
    if (sort) {
      sort.addEventListener("change", function () {
        state.sort = sort.value || "newest";
        syncUrl();
        refreshList();
      });
    }

    var toggle = document.getElementById("toggle-filters");
    if (toggle) {
      toggle.addEventListener("click", function (event) {
        event.stopPropagation();
        state.filtersOpen = !state.filtersOpen;
        paint(false);
      });
    }

    var apply = document.getElementById("apply-filters");
    if (apply) {
      apply.addEventListener("click", function () {
        var panel = document.getElementById("filter-panel");
        if (!panel) return;
        var minInput = panel.querySelector('[name="min"]');
        var maxInput = panel.querySelector('[name="max"]');
        var stockInput = panel.querySelector('[name="stock"]');
        state.min = minInput ? String(minInput.value || "").trim() : "";
        state.max = maxInput ? String(maxInput.value || "").trim() : "";
        state.stock = !!(stockInput && stockInput.checked);
        var bounds = priceBounds();
        state.priceError = bounds.invalid;
        if (bounds.invalid) {
          paint(false);
          return;
        }
        state.filtersOpen = false;
        syncUrl();
        paint(false);
      });
    }

    document.querySelectorAll(".home-cat").forEach(function (button) {
      button.addEventListener("click", function () {
        var next = button.getAttribute("data-cat") || "";
        state.cat = state.cat === next ? "" : next;
        syncUrl();
        paint(false);
      });
    });

    document.querySelectorAll("[data-clear]").forEach(function (button) {
      button.addEventListener("click", function () {
        clearChip(button.getAttribute("data-clear"));
        syncUrl();
        paint(false);
      });
    });

    document.addEventListener("click", onDocClick);
  }

  function onDocClick(event) {
    if (!state.filtersOpen) return;
    var wrap = document.querySelector(".filter-wrap");
    if (wrap && wrap.contains(event.target)) return;
    state.filtersOpen = false;
    var panel = document.getElementById("filter-panel");
    var toggle = document.getElementById("toggle-filters");
    if (panel) panel.classList.remove("open");
    if (toggle) toggle.classList.remove("active");
  }

  function refreshList() {
    var list = document.getElementById("home-list");
    if (!list) {
      paint(false);
      return;
    }
    list.innerHTML = listHtml();
    bindImages(list);
    document.querySelectorAll("[data-clear]").forEach(function (button) {
      button.addEventListener("click", function () {
        clearChip(button.getAttribute("data-clear"));
        syncUrl();
        paint(false);
      });
    });
  }

  function paint(full) {
    document.removeEventListener("click", onDocClick);
    if (full) {
      app.innerHTML =
        '<section class="hero"><img class="hero-photo" src="' + C2C.esc(C2C.path("images/hero-banner.jpg")) + '" alt="">' +
        '<div class="hero-copy"><div class="hero-copy-inner"><p class="hero-kicker">' + C2C.esc(t("heroKicker")) + "</p><h1>" + C2C.esc(t("heroTitle")) + '</h1><p class="hero-sub">' + C2C.esc(t("heroSub")) + "</p></div></div></section>" +
        toolbarHtml() +
        '<div id="home-list">' + listHtml() + "</div>";
    } else {
      var filter = document.getElementById("home-filter");
      var list = document.getElementById("home-list");
      if (filter) filter.outerHTML = toolbarHtml();
      if (list) list.innerHTML = listHtml();
    }
    bindFilterUi();
    bindImages(app);
  }

  paint(true);
};
