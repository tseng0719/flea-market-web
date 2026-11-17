window.C2CPage = async function () {
  var app = document.getElementById("app");
  var t = C2C.t;
  if (!C2C.configured()) {
    app.innerHTML = '<section class="panel"><h1>' + C2C.esc(t("navProducts")) + "</h1><p>" + C2C.esc(t("productNeed")) + "</p></section>";
    return;
  }
  var id = new URLSearchParams(location.search).get("id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    app.innerHTML = '<section class="panel"><h1>' + C2C.esc(t("notFound")) + "</h1></section>";
    return;
  }
  var res = await C2C.state.client
    .from("products")
    .select("id, seller_id, name, category, description, price, quantity, image_url, listing_status, seller:profiles!products_seller_id_fkey(display_name)")
    .eq("id", id)
    .maybeSingle();
  if (res.error) throw res.error;
  if (!res.data) {
    app.innerHTML = '<section class="panel"><h1>' + C2C.esc(t("notFoundOrHidden")) + '</h1><p><a href="' + C2C.esc(C2C.path("index.html")) + '">' + C2C.esc(t("backList")) + "</a></p></section>";
    return;
  }
  var product = res.data;
  await C2C.prepare([product.name, product.category, product.description, product.seller && product.seller.display_name]);
  var name = C2C.shown(product.name);
  var category = C2C.shown(product.category || t("uncategorized"));
  var description = product.description ? C2C.shown(product.description) : t("noDesc");
  var image = C2C.safeUrl(product.image_url);
  var media = image
    ? '<img src="' + C2C.esc(image) + '" alt="' + C2C.esc(name) + '">'
    : '<div class="thumb" aria-hidden="true">' + C2C.esc(name.slice(0, 1)) + "</div>";
  var hiddenNote = product.listing_status === "hidden"
    ? '<p class="badge hidden">' + C2C.esc(t("hiddenNote")) + "</p>"
    : "";
  var seller = product.seller && product.seller.display_name ? C2C.shown(product.seller.display_name) : t("sellerWord");

  app.innerHTML =
    '<div class="product-page">' +
    '<p class="product-back"><a href="' + C2C.esc(C2C.path("index.html")) + '">← ' + C2C.esc(t("backList")) + "</a></p>" +
    '<section class="product-sheet">' +
    '<div class="product-top">' +
    '<div class="product-media">' + media + "</div>" +
    '<div class="product-summary">' +
    '<div class="product-tags">' +
    '<span class="product-chip">' + C2C.esc(category) + "</span>" +
    '<span class="product-seller">' + C2C.esc(t("sellerOf", { name: seller })) + "</span>" +
    "</div>" +
    "<h1>" + C2C.esc(name) + "</h1>" +
    hiddenNote +
    '<div class="product-price-row">' +
    '<p class="product-price">' + C2C.esc(C2C.money(product.price)) + "</p>" +
    '<p class="product-stock">' + C2C.esc(t("stockLine", { n: product.quantity })) + "</p>" +
    "</div>" +
    '<form id="buy-form" class="product-buy">' +
    '<label class="field">' + C2C.esc(t("qty")) +
    '<input name="quantity" type="number" min="1" max="' + C2C.esc(product.quantity) + '" value="1" required>' +
    "</label>" +
    '<button class="btn btn-icon" type="submit">' + C2C.withIcon("cart", t("addCart")) + "</button>" +
    "</form>" +
    '<p class="hint" id="buy-hint"></p>' +
    "</div></div>" +
    '<div class="product-desc">' +
    "<h2>" + C2C.esc(t("productDesc")) + "</h2>" +
    "<p>" + C2C.esc(description) + "</p>" +
    "</div></section></div>";

  var form = document.getElementById("buy-form");
  var hint = document.getElementById("buy-hint");
  if (product.listing_status !== "active" || Number(product.quantity) < 1) {
    form.querySelector("button").disabled = true;
    hint.textContent = t("cannotBuy");
  }
  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!C2C.state.session) {
      location.href = C2C.path("login.html") + "?next=" + encodeURIComponent(location.pathname + location.search);
      return;
    }
    if (C2C.state.roles.indexOf("buyer") < 0) {
      C2C.flash(t("noBuyer"), "bad");
      return;
    }
    var qty = Number(new FormData(form).get("quantity"));
    if (!Number.isInteger(qty) || qty < 1) {
      C2C.flash(t("needInt"), "bad");
      return;
    }
    if (qty > Number(product.quantity)) {
      C2C.flash(t("onlyLeft", { n: product.quantity }), "bad");
      return;
    }
    var button = form.querySelector("button");
    button.disabled = true;
    var existing = await C2C.state.client.from("cart_items").select("quantity").eq("user_id", C2C.userId()).eq("product_id", product.id).maybeSingle();
    if (existing.error) {
      button.disabled = false;
      C2C.flash(C2C.errorText(existing.error), "bad");
      return;
    }
    var nextQty = (existing.data ? Number(existing.data.quantity) : 0) + qty;
    if (nextQty > Number(product.quantity) || nextQty > 100) {
      button.disabled = false;
      C2C.flash(t("cartOver"), "bad");
      return;
    }
    var write = existing.data
      ? C2C.state.client.from("cart_items").update({ quantity: nextQty }).eq("user_id", C2C.userId()).eq("product_id", product.id)
      : C2C.state.client.from("cart_items").insert({ user_id: C2C.userId(), product_id: product.id, quantity: nextQty });
    var saved = await write;
    button.disabled = false;
    if (saved.error) {
      C2C.flash(C2C.errorText(saved.error), "bad");
      return;
    }
    C2C.flash(t("added"));
    C2C.refreshCartCount();
    hint.innerHTML = '<a href="' + C2C.esc(C2C.path("cart.html")) + '">' + C2C.esc(t("goCart")) + "</a>";
  });
};
