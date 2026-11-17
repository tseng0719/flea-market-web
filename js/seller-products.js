var sellerUi = {
  products: [],
  byId: {},
  editing: null,
  showForm: false,
  q: "",
  category: "",
  status: "",
  sort: "newest",
  lowOnly: false,
  searchTimer: null
};

window.C2CPage = async function () {
  if (!C2C.guard("seller")) return;
  C2C.alignMode("seller");
  await loadProducts();
};

async function loadProducts(keepForm) {
  var res = await C2C.state.client
    .from("products")
    .select("id, name, category, description, price, quantity, image_url, listing_status, created_at")
    .eq("seller_id", C2C.userId())
    .order("created_at", { ascending: false });
  if (res.error) throw res.error;
  sellerUi.products = res.data || [];
  sellerUi.byId = {};
  sellerUi.products.forEach(function (product) {
    sellerUi.byId[product.id] = product;
  });
  var texts = [];
  sellerUi.products.forEach(function (product) {
    texts.push(product.name, product.category, product.description);
  });
  await C2C.prepare(texts);
  if (!keepForm) {
    sellerUi.editing = null;
    sellerUi.showForm = false;
  } else if (sellerUi.editing && sellerUi.editing.id && sellerUi.byId[sellerUi.editing.id]) {
    sellerUi.editing = sellerUi.byId[sellerUi.editing.id];
  }
  paint();
}

function categoriesOf(products) {
  var map = {};
  products.forEach(function (product) {
    var raw = (product.category || "").trim();
    var key = raw || "__none__";
    if (!map[key]) {
      map[key] = {
        key: key,
        label: raw ? C2C.shown(raw) : C2C.t("uncategorized"),
        count: 0
      };
    }
    map[key].count += 1;
  });
  return Object.keys(map).map(function (key) { return map[key]; }).sort(function (a, b) {
    return a.label.localeCompare(b.label, window.C2CLang.get() === "en" ? "en" : "zh-Hant");
  });
}

function filteredProducts() {
  var q = sellerUi.q.trim().toLowerCase();
  var list = sellerUi.products.filter(function (product) {
    if (sellerUi.status && product.listing_status !== sellerUi.status) return false;
    if (sellerUi.lowOnly && Number(product.quantity) > 1) return false;
    var rawCat = (product.category || "").trim();
    if (sellerUi.category === "__none__" && rawCat) return false;
    if (sellerUi.category && sellerUi.category !== "__none__" && rawCat !== sellerUi.category) return false;
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
    if (sellerUi.sort === "name") {
      return C2C.shown(a.name).localeCompare(C2C.shown(b.name), window.C2CLang.get() === "en" ? "en" : "zh-Hant");
    }
    if (sellerUi.sort === "priceAsc") return Number(a.price) - Number(b.price);
    if (sellerUi.sort === "priceDesc") return Number(b.price) - Number(a.price);
    if (sellerUi.sort === "stockAsc") return Number(a.quantity) - Number(b.quantity);
    if (sellerUi.sort === "stockDesc") return Number(b.quantity) - Number(a.quantity);
    return String(b.created_at).localeCompare(String(a.created_at));
  });
  return list;
}

function categoryDatalist() {
  var raw = {};
  sellerUi.products.forEach(function (product) {
    var category = (product.category || "").trim();
    if (category) raw[category] = true;
  });
  var keys = Object.keys(raw).sort();
  if (!keys.length) return "";
  return '<datalist id="seller-cat-list">' + keys.map(function (category) {
    return '<option value="' + C2C.esc(window.C2CLang.get() === "en" ? C2C.shown(category) : category) + '">';
  }).join("") + "</datalist>";
}

function formHtml(product) {
  product = product || {};
  var t = C2C.t;
  var preview = C2C.safeUrl(product.image_url)
    ? '<img class="preview" src="' + C2C.esc(C2C.safeUrl(product.image_url)) + '" alt="">'
    : '<p class="hint">' + C2C.esc(t("imageNone")) + "</p>";
  return '<form id="product-form" class="form seller-form">' +
    '<input type="hidden" name="id" value="' + C2C.esc(product.id || "") + '">' +
    '<div class="form-grid">' +
    '<label class="field">' + C2C.esc(t("name")) + '<input name="name" maxlength="120" required value="' + C2C.esc(C2C.shown(product.name || "")) + '"></label>' +
    '<label class="field">' + C2C.esc(t("category")) + '<input name="category" maxlength="60" list="seller-cat-list" value="' + C2C.esc(C2C.shown(product.category || "")) + '"></label>' +
    '<label class="field span-2">' + C2C.esc(t("desc")) + '<textarea name="description" maxlength="4000">' + C2C.esc(C2C.shown(product.description || "")) + "</textarea></label>" +
    '<label class="field">' + C2C.esc(t("price")) + '<input name="price" type="number" min="0" step="0.01" required value="' + C2C.esc(product.price == null ? "" : product.price) + '"></label>' +
    '<label class="field">' + C2C.esc(t("stockHead")) + '<input name="quantity" type="number" min="0" step="1" required value="' + C2C.esc(product.quantity == null ? "3" : product.quantity) + '"></label>' +
    '<label class="field span-2">' + C2C.esc(t("image")) + '<input name="image_file" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label>' +
    "</div>" +
    '<p class="hint">' + C2C.esc(t("imageHint")) + (product.image_url ? " " + C2C.esc(t("imageKeep")) : "") + "</p>" +
    '<div class="image-preview">' + preview + "</div>" + categoryDatalist() +
    '<div class="row"><button class="btn" type="submit">' + C2C.esc(product.id ? t("save") : t("listBtn")) + '</button><button class="btn ghost" id="reset-form" type="button">' + C2C.esc(t("clear")) + "</button></div></form>";
}

function inventoryHtml() {
  var t = C2C.t;
  var all = sellerUi.products;
  var shown = filteredProducts();
  var cards = shown.map(function (product) {
    var name = C2C.shown(product.name);
    var category = C2C.shown(product.category || t("uncategorized"));
    var status = product.listing_status === "active" ? t("onSale") : t("offSale");
    var low = Number(product.quantity) <= 1;
    var image = C2C.safeUrl(product.image_url);
    var media = image
      ? '<img src="' + C2C.esc(image) + '" alt="">'
      : '<div class="thumb">' + C2C.esc((name || "·").slice(0, 1)) + "</div>";
    return '<article class="inv-card' + (product.listing_status !== "active" ? " is-hidden" : "") + '">' +
      '<div class="inv-media">' + media + "</div>" +
      '<div class="inv-body">' +
      '<div class="spread"><h3>' + C2C.esc(name) + '</h3><span class="badge ' + (product.listing_status === "active" ? "completed" : "hidden") + '">' + C2C.esc(status) + "</span></div>" +
      '<p class="hint">' + C2C.esc(category) + (low ? ' · <span class="low">' + C2C.esc(t("lowStockBadge")) + "</span>" : "") + "</p>" +
      '<p class="price">' + C2C.esc(C2C.money(product.price)) + "　" + C2C.esc(t("stockHead")) + " " + C2C.esc(product.quantity) + "</p>" +
      '<div class="inv-actions">' +
      '<button class="btn ghost" type="button" data-edit="' + C2C.esc(product.id) + '">' + C2C.esc(t("edit")) + "</button>" +
      '<button class="btn ghost" type="button" data-toggle="' + C2C.esc(product.id) + '" data-status="' + C2C.esc(product.listing_status) + '">' +
      C2C.esc(product.listing_status === "active" ? t("unlist") : t("relist")) + "</button>" +
      '<form data-stock="' + C2C.esc(product.id) + '" class="stock-form" aria-label="' + C2C.esc(t("stockQuick")) + '">' +
      '<input name="quantity" type="number" min="0" step="1" value="' + C2C.esc(product.quantity) + '">' +
      '<button class="btn secondary" type="submit">' + C2C.esc(t("updateStock")) + "</button>" +
      "</form></div></div></article>";
  }).join("");

  return '<div class="spread"><h2>' + C2C.esc(t("inventoryTitle")) + '</h2><p class="hint">' +
    C2C.esc(t("resultCount", { shown: shown.length, total: all.length })) + "</p></div>" +
    (all.length === 0
      ? "<p>" + C2C.esc(t("noMine")) + "</p>"
      : shown.length
        ? '<div class="inv-grid">' + cards + "</div>"
        : "<p>" + C2C.esc(t("noMineFilter")) + "</p>");
}

function paint() {
  var app = document.getElementById("app");
  var t = C2C.t;
  var all = sellerUi.products;
  var cats = categoriesOf(all);
  var activeCount = all.filter(function (p) { return p.listing_status === "active"; }).length;
  var hiddenCount = all.length - activeCount;
  var lowCount = all.filter(function (p) { return Number(p.quantity) <= 1; }).length;
  var catOptions = '<option value="">' + C2C.esc(t("allCategories")) + "</option>" +
    cats.map(function (item) {
      return '<option value="' + C2C.esc(item.key) + '"' + (sellerUi.category === item.key ? " selected" : "") + ">" +
        C2C.esc(item.label) + " (" + item.count + ")</option>";
    }).join("");

  var formBlock = "";
  if (sellerUi.showForm) {
    formBlock = '<section class="panel seller-form-panel" id="seller-form-panel">' +
      '<div class="spread"><h2>' + C2C.esc(sellerUi.editing && sellerUi.editing.id ? t("editTitle") : t("listTitle")) + "</h2>" +
      '<button class="btn ghost" type="button" id="close-form">' + C2C.esc(t("closeForm")) + "</button></div>" +
      formHtml(sellerUi.editing || {}) +
      "</section>";
  }

  app.innerHTML =
    '<div class="page-head"><div><h1>' + C2C.esc(t("mineTitle")) + '</h1><p class="hint">' + C2C.esc(t("mineHint")) + "</p></div>" +
    '<button class="btn" type="button" id="open-new">' + C2C.esc(t("openNew")) + "</button></div>" +
    '<section class="panel"><h2>' + C2C.esc(t("deliverySettings")) + '</h2><p class="hint">' + C2C.esc(t("deliverySettingsHint")) + "</p>" +
    '<ul class="items"><li>' + C2C.esc(t("fulfill_cvs")) + " — " + C2C.esc(C2C.money(60)) + "</li>" +
    "<li>" + C2C.esc(t("fulfill_home")) + " — " + C2C.esc(C2C.money(80)) + "</li>" +
    "<li>" + C2C.esc(t("platformFee")) + " — " + C2C.esc(C2C.money(4)) + "</li></ul></section>" +
    '<div class="seller-stats">' +
    '<button type="button" class="seller-stat' + (!sellerUi.status && !sellerUi.lowOnly && !sellerUi.category && !sellerUi.q ? " current" : "") + '" data-stat="all"><span>' + C2C.esc(t("statTotal")) + "</span><strong>" + all.length + "</strong></button>" +
    '<button type="button" class="seller-stat' + (sellerUi.status === "active" && !sellerUi.lowOnly ? " current" : "") + '" data-stat="active"><span>' + C2C.esc(t("statActive")) + "</span><strong>" + activeCount + "</strong></button>" +
    '<button type="button" class="seller-stat' + (sellerUi.status === "hidden" && !sellerUi.lowOnly ? " current" : "") + '" data-stat="hidden"><span>' + C2C.esc(t("statHidden")) + "</span><strong>" + hiddenCount + "</strong></button>" +
    '<button type="button" class="seller-stat' + (sellerUi.lowOnly ? " current" : "") + '" data-stat="low"><span>' + C2C.esc(t("statLow")) + "</span><strong>" + lowCount + "</strong></button>" +
    "</div>" +
    '<form id="seller-filters" class="seller-filters">' +
    '<label class="field grow">' + C2C.esc(t("search")) + '<input name="q" value="' + C2C.esc(sellerUi.q) + '" placeholder="' + C2C.esc(t("sellerSearchPh")) + '" autocomplete="off"></label>' +
    '<label class="field">' + C2C.esc(t("category")) + '<select name="category">' + catOptions + "</select></label>" +
    '<label class="field">' + C2C.esc(t("status")) + '<select name="status"><option value="">' + C2C.esc(t("allStatus")) + '</option><option value="active"' + (sellerUi.status === "active" ? " selected" : "") + ">" + C2C.esc(t("onSale")) + '</option><option value="hidden"' + (sellerUi.status === "hidden" ? " selected" : "") + ">" + C2C.esc(t("offSale")) + "</option></select></label>" +
    '<label class="field">' + C2C.esc(t("sortBy")) + '<select name="sort">' +
    '<option value="newest"' + (sellerUi.sort === "newest" ? " selected" : "") + ">" + C2C.esc(t("sortNewest")) + "</option>" +
    '<option value="name"' + (sellerUi.sort === "name" ? " selected" : "") + ">" + C2C.esc(t("sortName")) + "</option>" +
    '<option value="priceAsc"' + (sellerUi.sort === "priceAsc" ? " selected" : "") + ">" + C2C.esc(t("sortPriceAsc")) + "</option>" +
    '<option value="priceDesc"' + (sellerUi.sort === "priceDesc" ? " selected" : "") + ">" + C2C.esc(t("sortPriceDesc")) + "</option>" +
    '<option value="stockAsc"' + (sellerUi.sort === "stockAsc" ? " selected" : "") + ">" + C2C.esc(t("sortStockAsc")) + "</option>" +
    '<option value="stockDesc"' + (sellerUi.sort === "stockDesc" ? " selected" : "") + ">" + C2C.esc(t("sortStockDesc")) + "</option>" +
    "</select></label></form>" +
    formBlock +
    '<section class="panel inventory-panel" id="inventory-panel">' + inventoryHtml() + "</section>";

  bindUi();
}

function refreshInventory() {
  var panel = document.getElementById("inventory-panel");
  if (!panel) {
    paint();
    return;
  }
  panel.innerHTML = inventoryHtml();
  bindInventoryActions();
  document.querySelectorAll("[data-stat]").forEach(function (button) {
    var kind = button.getAttribute("data-stat");
    var on = false;
    if (kind === "all") on = !sellerUi.status && !sellerUi.lowOnly && !sellerUi.category && !sellerUi.q;
    if (kind === "active") on = sellerUi.status === "active" && !sellerUi.lowOnly;
    if (kind === "hidden") on = sellerUi.status === "hidden" && !sellerUi.lowOnly;
    if (kind === "low") on = !!sellerUi.lowOnly;
    button.classList.toggle("current", on);
  });
}

function readFiltersFromForm() {
  var form = document.getElementById("seller-filters");
  if (!form) return;
  var data = new FormData(form);
  sellerUi.q = String(data.get("q") || "");
  sellerUi.category = String(data.get("category") || "");
  sellerUi.status = String(data.get("status") || "");
  sellerUi.sort = String(data.get("sort") || "newest");
  if (sellerUi.status) sellerUi.lowOnly = false;
}

function bindInventoryActions() {
  document.querySelectorAll("[data-edit]").forEach(function (button) {
    button.addEventListener("click", function () {
      sellerUi.editing = sellerUi.byId[button.getAttribute("data-edit")] || null;
      sellerUi.showForm = true;
      paint();
      var panel = document.getElementById("seller-form-panel");
      if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  document.querySelectorAll("[data-toggle]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var next = button.getAttribute("data-status") === "active" ? "hidden" : "active";
      var saved = await C2C.state.client.from("products").update({ listing_status: next }).eq("id", button.getAttribute("data-toggle")).eq("seller_id", C2C.userId());
      if (saved.error) C2C.flash(C2C.errorText(saved.error), "bad");
      else C2C.flash(next === "hidden" ? C2C.t("didHide") : C2C.t("didShow"));
      await loadProducts(true);
    });
  });
  document.querySelectorAll("[data-stock]").forEach(function (form) {
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var qty = Number(new FormData(form).get("quantity"));
      if (!Number.isInteger(qty) || qty < 0) {
        C2C.flash(C2C.t("stockInt"), "bad");
        return;
      }
      var saved = await C2C.state.client.from("products").update({ quantity: qty }).eq("id", form.getAttribute("data-stock")).eq("seller_id", C2C.userId());
      if (saved.error) C2C.flash(C2C.errorText(saved.error), "bad");
      else C2C.flash(C2C.t("stockSaved"));
      await loadProducts(true);
    });
  });
}

function bindUi() {
  var filterForm = document.getElementById("seller-filters");
  if (filterForm) {
    var qInput = filterForm.querySelector('[name="q"]');
    if (qInput) {
      qInput.addEventListener("input", function () {
        sellerUi.q = qInput.value;
        clearTimeout(sellerUi.searchTimer);
        sellerUi.searchTimer = setTimeout(refreshInventory, 160);
      });
    }
    filterForm.addEventListener("change", function () {
      readFiltersFromForm();
      refreshInventory();
    });
    filterForm.addEventListener("submit", function (event) { event.preventDefault(); });
  }

  document.querySelectorAll("[data-stat]").forEach(function (button) {
    button.addEventListener("click", function () {
      var kind = button.getAttribute("data-stat");
      if (kind === "all") {
        sellerUi.status = "";
        sellerUi.category = "";
        sellerUi.q = "";
        sellerUi.sort = "newest";
        sellerUi.lowOnly = false;
      } else if (kind === "active") {
        sellerUi.status = "active";
        sellerUi.lowOnly = false;
      } else if (kind === "hidden") {
        sellerUi.status = "hidden";
        sellerUi.lowOnly = false;
      } else if (kind === "low") {
        sellerUi.lowOnly = true;
        sellerUi.status = "";
        sellerUi.sort = "stockAsc";
      }
      paint();
    });
  });

  var openNew = document.getElementById("open-new");
  if (openNew) {
    openNew.addEventListener("click", function () {
      sellerUi.editing = {};
      sellerUi.showForm = true;
      paint();
      var panel = document.getElementById("seller-form-panel");
      if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  var closeForm = document.getElementById("close-form");
  if (closeForm) {
    closeForm.addEventListener("click", function () {
      sellerUi.editing = null;
      sellerUi.showForm = false;
      paint();
    });
  }
  var reset = document.getElementById("reset-form");
  if (reset) {
    reset.addEventListener("click", function () {
      sellerUi.editing = null;
      sellerUi.showForm = false;
      paint();
    });
  }

  var productForm = document.getElementById("product-form");
  if (productForm) {
    productForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      var button = form.querySelector('button[type="submit"]');
      var data = new FormData(form);
      var id = String(data.get("id") || "");
      var original = id && sellerUi.byId[id] ? sellerUi.byId[id] : null;
      function keepSource(field, value) {
        if (!original || window.C2CLang.get() !== "en") return value;
        if (value === C2C.shown(original[field] || "")) return original[field] || "";
        return value;
      }
      var payload = {
        name: keepSource("name", String(data.get("name") || "").trim()),
        category: keepSource("category", String(data.get("category") || "").trim()),
        description: keepSource("description", String(data.get("description") || "").trim()),
        price: Number(data.get("price")),
        quantity: Number(data.get("quantity")),
        image_url: original && original.image_url ? original.image_url : ""
      };
      if (!payload.name || payload.price < 0 || !Number.isInteger(payload.quantity) || payload.quantity < 0) {
        C2C.flash(C2C.t("badForm"), "bad");
        return;
      }
      var file = data.get("image_file");
      button.disabled = true;
      try {
        if (file && file.size) payload.image_url = await C2C.uploadProductImage(file);
      } catch (err) {
        button.disabled = false;
        C2C.flash(err && err.message === C2C.t("badImage") ? C2C.t("badImage") : (C2C.errorText(err) || C2C.t("imageUploadFail")), "bad");
        return;
      }
      var write = id
        ? C2C.state.client.from("products").update(payload).eq("id", id).eq("seller_id", C2C.userId())
        : C2C.state.client.from("products").insert(Object.assign({ seller_id: C2C.userId(), listing_status: "active" }, payload));
      var saved = await write;
      button.disabled = false;
      if (saved.error) {
        C2C.flash(C2C.errorText(saved.error), "bad");
        return;
      }
      C2C.flash(id ? C2C.t("saved") : C2C.t("listed"));
      sellerUi.showForm = false;
      sellerUi.editing = null;
      await loadProducts();
    });
  }

  bindInventoryActions();
}
