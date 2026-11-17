var PLATFORM_FEE = 4;
var CVS_FEE = 60;
var HOME_FEE = 80;
var CVS_CHAINS = [
  { id: "seven_eleven", labelKey: "cvs_seven_eleven" },
  { id: "familymart", labelKey: "cvs_familymart" },
  { id: "hilife", labelKey: "cvs_hilife" },
  { id: "okmart", labelKey: "cvs_okmart" }
];
var checkoutDraft = {};
var selectedMap = {};
var activeSellerId = "";
var cartCache = { groups: [], lines: [] };

var SHOP_ICON =
  '<svg class="shop-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M4 7.5 5.4 4h13.2L20 7.5V9a2 2 0 0 1-4 0 2 2 0 0 1-4 0 2 2 0 0 1-4 0 2 2 0 1 1-4 0V7.5zm1.2 3.3c.5.4 1.1.7 1.8.7s1.3-.3 1.8-.7c.5.4 1.1.7 1.8.7s1.3-.3 1.8-.7c.5.4 1.1.7 1.8.7s1.3-.3 1.8-.7c.5.4 1.1.7 1.8.7.3 0 .5 0 .8-.1V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4.2 19v-7.6c.3.1.5.1.8.1.7 0 1.3-.3 1.8-.7z"/>' +
  "</svg>";

window.C2CPage = async function () {
  if (!C2C.guard("buyer")) return;
  C2C.alignMode("buyer");
  activeSellerId = "";
  await renderCart();
};

function groupBySeller(lines) {
  var groups = {};
  var order = [];
  lines.forEach(function (line) {
    var product = line.product || {};
    var sellerId = product.seller_id || (product.seller && product.seller.id) || "unknown";
    if (!groups[sellerId]) {
      groups[sellerId] = {
        sellerId: sellerId,
        sellerName: product.seller && product.seller.display_name ? C2C.shown(product.seller.display_name) : C2C.t("sellerWord"),
        lines: []
      };
      order.push(sellerId);
    }
    groups[sellerId].lines.push(line);
  });
  return order.map(function (id) { return groups[id]; });
}

function draftFor(sellerId) {
  if (!checkoutDraft[sellerId]) {
    var profile = (C2C.state && C2C.state.profile) || {};
    checkoutDraft[sellerId] = {
      fulfillment_method: "cvs",
      cvs_chain: "",
      contact_name: profile.display_name || "",
      contact_phone: profile.phone || "",
      fulfillment_detail: ""
    };
  }
  return checkoutDraft[sellerId];
}

function captureDraft() {
  var form = document.querySelector("[data-seller-form]");
  if (!form) return;
  var id = form.getAttribute("data-seller-form");
  var d = draftFor(id);
  ["fulfillment_method", "cvs_chain", "contact_name", "contact_phone", "fulfillment_detail"].forEach(function (name) {
    if (form.elements[name]) d[name] = form.elements[name].value;
  });
}

function shippingFeeFor(method) {
  if (method === "cvs") return CVS_FEE;
  if (method === "home") return HOME_FEE;
  return 0;
}

function isSelected(productId) {
  return selectedMap[productId] !== false;
}

function selectedLines(group) {
  return group.lines.filter(function (line) { return isSelected(line.product_id); });
}

function syncSelection(lines) {
  var alive = {};
  lines.forEach(function (line) {
    alive[line.product_id] = true;
    if (selectedMap[line.product_id] == null) selectedMap[line.product_id] = true;
  });
  Object.keys(selectedMap).forEach(function (id) {
    if (!alive[id]) delete selectedMap[id];
  });
}

function itemsSubtotal(lines) {
  return lines.reduce(function (sum, line) {
    return sum + Number((line.product && line.product.price) || 0) * Number(line.quantity || 0);
  }, 0);
}

function itemCount(lines) {
  return lines.reduce(function (sum, line) {
    return sum + Number(line.quantity || 0);
  }, 0);
}

function validateGroup(group, t) {
  var d = draftFor(group.sellerId);
  if (d.fulfillment_method !== "cvs" && d.fulfillment_method !== "home") return t("needFulfillment");
  if (!d.contact_name.trim() || d.contact_name.trim().length > 40) return t("needRecipient");
  if (!/^[0-9+\-]{8,20}$/.test(d.contact_phone.replace(/\s/g, ""))) return t("badPhone");
  if (d.fulfillment_method === "cvs") {
    if (!CVS_CHAINS.some(function (c) { return c.id === d.cvs_chain; })) return t("needCvsChain");
    if (d.fulfillment_detail.trim().length < 2) return t("needCvsStore");
  } else if (d.fulfillment_detail.trim().length < 5) {
    return t("needAddress");
  }
  return "";
}

function findGroup(sellerId) {
  return cartCache.groups.find(function (group) { return group.sellerId === sellerId; }) || null;
}

async function loadCartData() {
  var res = await C2C.state.client
    .from("cart_items")
    .select("quantity, product_id, product:products!cart_items_product_id_fkey(id, seller_id, name, price, quantity, image_url, listing_status, seller:profiles!products_seller_id_fkey(id, display_name))")
    .eq("user_id", C2C.userId());
  if (res.error) throw res.error;
  var lines = res.data || [];
  var texts = [];
  lines.forEach(function (line) {
    if (!line.product) return;
    texts.push(line.product.name);
    if (line.product.seller) texts.push(line.product.seller.display_name);
  });
  await C2C.prepare(texts);
  syncSelection(lines);
  cartCache.lines = lines;
  cartCache.groups = groupBySeller(lines);
  return cartCache;
}

function mediaHtml(product, name) {
  var image = C2C.safeUrl(product.image_url);
  if (image) return '<img src="' + C2C.esc(image) + '" alt="' + C2C.esc(name) + '">';
  return '<div class="thumb" aria-hidden="true">' + C2C.esc(name.slice(0, 1)) + "</div>";
}

function bindQtyAndRemove(app, t, afterChange) {
  app.querySelectorAll("[data-qty]").forEach(function (input) {
    input.addEventListener("change", async function () {
      var qty = Number(input.value);
      if (!Number.isInteger(qty) || qty < 1 || qty > 100) {
        C2C.flash(t("qtyRange"), "bad");
        await afterChange();
        return;
      }
      var saved = await C2C.state.client.from("cart_items").update({ quantity: qty }).eq("user_id", C2C.userId()).eq("product_id", input.getAttribute("data-qty"));
      if (saved.error) C2C.flash(C2C.errorText(saved.error), "bad");
      await afterChange();
      C2C.refreshCartCount();
    });
  });
  app.querySelectorAll("[data-remove]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var id = button.getAttribute("data-remove");
      var removed = await C2C.state.client.from("cart_items").delete().eq("user_id", C2C.userId()).eq("product_id", id);
      if (removed.error) C2C.flash(C2C.errorText(removed.error), "bad");
      delete selectedMap[id];
      await afterChange();
      C2C.refreshCartCount();
    });
  });
}

function bindChecks(app) {
  app.querySelectorAll("[data-check-item]").forEach(function (input) {
    input.addEventListener("change", function () {
      selectedMap[input.getAttribute("data-check-item")] = !!input.checked;
      renderCart();
    });
  });
  app.querySelectorAll("[data-check-seller]").forEach(function (input) {
    input.addEventListener("change", function () {
      var sellerId = input.getAttribute("data-check-seller");
      var group = findGroup(sellerId);
      if (!group) return;
      group.lines.forEach(function (line) {
        selectedMap[line.product_id] = !!input.checked;
      });
      renderCart();
    });
  });
}

function lineRowHtml(line, t) {
  var product = line.product || {};
  var name = C2C.shown(product.name || t("missingItem"));
  var warn = !line.product ? t("unread") : product.listing_status !== "active" ? t("hidden") : Number(product.quantity) < Number(line.quantity) ? t("lowStock") : "";
  var checked = isSelected(line.product_id) ? " checked" : "";
  return '<div class="cart-line">' +
    '<label class="cart-check"><input type="checkbox" data-check-item="' + C2C.esc(line.product_id) + '"' + checked + "></label>" +
    '<div class="cart-line-media">' + mediaHtml(product, name) + "</div>" +
    '<div class="cart-line-body">' +
    '<p class="cart-line-name">' + C2C.esc(name) + (warn ? ' <span class="hint">' + C2C.esc(warn) + "</span>" : "") + "</p>" +
    '<p class="cart-line-price">' + C2C.esc(C2C.money(product.price || 0)) + "</p>" +
    '<div class="cart-line-actions">' +
    '<label class="cart-qty">' + C2C.esc(t("qty")) +
    ' <input data-qty="' + C2C.esc(line.product_id) + '" type="number" min="1" max="100" value="' + C2C.esc(line.quantity) + '">' +
    "</label>" +
    '<button class="cart-item-x cart-item-x-plain" type="button" data-remove="' + C2C.esc(line.product_id) + '" title="' + C2C.esc(t("cartRemoveItem")) + '" aria-label="' + C2C.esc(t("cartRemoveItem")) + '">×</button>' +
    "</div></div></div>";
}

function renderOverview(app, t, groups) {
  var cards = groups.map(function (group) {
    var picked = selectedLines(group);
    var allOn = group.lines.length > 0 && picked.length === group.lines.length;
    var sub = itemsSubtotal(picked);
    var rows = group.lines.map(function (line) { return lineRowHtml(line, t); }).join("");
    var disabled = picked.length ? "" : " disabled";
    return '<article class="panel cart-seller-card">' +
      '<div class="cart-shop-head">' +
      '<label class="cart-check"><input type="checkbox" data-check-seller="' + C2C.esc(group.sellerId) + '"' + (allOn ? " checked" : "") + "></label>" +
      '<div class="cart-shop-title">' + SHOP_ICON +
      "<strong>" + C2C.esc(t("sellerOf", { name: group.sellerName })) + "</strong>" +
      '<span class="hint">' + C2C.esc(t("cartSellerSummary", { items: itemCount(group.lines), lines: group.lines.length })) + "</span>" +
      "</div></div>" +
      '<div class="cart-line-list">' + rows + "</div>" +
      '<div class="cart-seller-foot">' +
      '<div><p class="hint">' + C2C.esc(t("cartSelectedSubtotal")) + "</p>" +
      '<p class="price">' + C2C.esc(C2C.money(sub)) + "</p></div>" +
      '<button class="btn btn-icon" type="button" data-open-seller="' + C2C.esc(group.sellerId) + '"' + disabled + ">" + C2C.withIcon("checkout", t("cartEnterSeller")) + "</button>" +
      "</div></article>";
  }).join("");

  app.innerHTML =
    '<div class="page-head"><div><h1>' + C2C.esc(t("cartTitle")) + '</h1><p class="hint">' + C2C.esc(t("cartHintStep")) + "</p></div></div>" +
    cards;

  bindChecks(app);
  bindQtyAndRemove(app, t, renderCart);
  app.querySelectorAll("[data-open-seller]").forEach(function (button) {
    button.addEventListener("click", function () {
      var sellerId = button.getAttribute("data-open-seller");
      var group = findGroup(sellerId);
      if (!group || !selectedLines(group).length) {
        C2C.flash(t("needSelectItems"), "bad");
        return;
      }
      activeSellerId = sellerId;
      renderCart();
    });
  });
}

function renderSellerCheckout(app, t, group) {
  var picked = selectedLines(group);
  if (!picked.length) {
    activeSellerId = "";
    renderOverview(app, t, cartCache.groups);
    return;
  }
  var checkoutGroup = { sellerId: group.sellerId, sellerName: group.sellerName, lines: picked };
  var d = draftFor(group.sellerId);
  if (d.fulfillment_method !== "cvs" && d.fulfillment_method !== "home") d.fulfillment_method = "cvs";
  var sub = itemsSubtotal(picked);
  var ship = shippingFeeFor(d.fulfillment_method);
  var plat = PLATFORM_FEE;
  var orderTotal = sub + ship + plat;
  var methodOptions =
    '<option value="cvs"' + (d.fulfillment_method === "cvs" ? " selected" : "") + ">" + C2C.esc(t("fulfill_cvs")) + " — " + C2C.esc(C2C.money(CVS_FEE)) + "</option>" +
    '<option value="home"' + (d.fulfillment_method === "home" ? " selected" : "") + ">" + C2C.esc(t("fulfill_home")) + " — " + C2C.esc(C2C.money(HOME_FEE)) + "</option>";
  var fields =
    '<label class="field">' + C2C.esc(t("recipientName")) + '<input name="contact_name" maxlength="40" required value="' + C2C.esc(d.contact_name) + '"></label>' +
    '<label class="field">' + C2C.esc(t("recipientPhone")) + '<input name="contact_phone" maxlength="20" inputmode="tel" required value="' + C2C.esc(d.contact_phone) + '"></label>';
  if (d.fulfillment_method === "cvs") {
    var chainOptions = '<option value="">' + C2C.esc(t("chooseCvsChain")) + "</option>" +
      CVS_CHAINS.map(function (chain) {
        return '<option value="' + C2C.esc(chain.id) + '"' + (d.cvs_chain === chain.id ? " selected" : "") + ">" + C2C.esc(t(chain.labelKey)) + "</option>";
      }).join("");
    fields +=
      '<label class="field span-2">' + C2C.esc(t("cvsChain")) + '<select name="cvs_chain" required>' + chainOptions + "</select></label>" +
      '<label class="field span-2">' + C2C.esc(t("cvsDetail")) + '<textarea name="fulfillment_detail" maxlength="200" required placeholder="' + C2C.esc(t("cvsStorePh")) + '">' + C2C.esc(d.fulfillment_detail) + "</textarea></label>";
  } else {
    if (!d.fulfillment_detail && C2C.state.profile && C2C.state.profile.address) {
      d.fulfillment_detail = C2C.state.profile.address;
    }
    fields +=
      '<label class="field span-2">' + C2C.esc(t("recipientAddress")) + '<textarea name="fulfillment_detail" maxlength="200" required>' + C2C.esc(d.fulfillment_detail) + "</textarea></label>";
  }

  var preview = picked.map(function (line) {
    var product = line.product || {};
    var name = C2C.shown(product.name || t("missingItem"));
    return '<div class="cart-line cart-line-readonly">' +
      '<div class="cart-line-media">' + mediaHtml(product, name) + "</div>" +
      '<div class="cart-line-body">' +
      '<p class="cart-line-name">' + C2C.esc(name) + "</p>" +
      '<p class="cart-line-price">' + C2C.esc(C2C.money(product.price || 0)) + " × " + C2C.esc(line.quantity) + "</p>" +
      "</div></div>";
  }).join("");

  app.innerHTML =
    '<p class="product-back"><a href="#" id="back-cart">← ' + C2C.esc(t("backToCart")) + "</a></p>" +
    '<div class="page-head"><div><h1 class="cart-shop-heading">' + SHOP_ICON + " " + C2C.esc(t("sellerOf", { name: group.sellerName })) + '</h1><p class="hint">' + C2C.esc(t("cartSellerCheckoutHint")) + "</p></div></div>" +
    '<section class="panel checkout-seller"><div class="cart-line-list">' + preview + "</div></section>" +
    '<section class="panel">' +
    "<h2>" + C2C.esc(t("checkoutInfo")) + "</h2>" +
    '<p class="hint">' + C2C.esc(t("checkoutInfoHint")) + "</p>" +
    '<form class="checkout-grid" data-seller-form="' + C2C.esc(group.sellerId) + '">' +
    '<label class="field span-2">' + C2C.esc(t("fulfillment")) + '<select name="fulfillment_method" required>' + methodOptions + "</select></label>" +
    fields +
    "</form>" +
    '<div class="fee-box">' +
    "<p>" + C2C.esc(t("itemsSubtotal")) + " <strong>" + C2C.esc(C2C.money(sub)) + "</strong></p>" +
    "<p>" + C2C.esc(t("shippingFee")) + " <strong>" + C2C.esc(C2C.money(ship)) + "</strong></p>" +
    "<p>" + C2C.esc(t("platformFee")) + " <strong>" + C2C.esc(C2C.money(plat)) + "</strong></p>" +
    '<p class="price">' + C2C.esc(t("orderTotal")) + " " + C2C.esc(C2C.money(orderTotal)) + "</p>" +
    "</div>" +
    '<p class="hint">' + C2C.esc(t("feeHintTw")) + "</p>" +
    '<button class="btn btn-icon" id="checkout" type="button">' + C2C.withIcon("checkout", t("checkoutSeller")) + "</button>" +
    "</section>";

  document.getElementById("back-cart").addEventListener("click", function (event) {
    event.preventDefault();
    captureDraft();
    activeSellerId = "";
    renderCart();
  });
  app.querySelectorAll('[name="fulfillment_method"]').forEach(function (select) {
    select.addEventListener("change", function () {
      captureDraft();
      renderCart();
    });
  });
  document.getElementById("checkout").addEventListener("click", async function () {
    captureDraft();
    var problem = validateGroup(checkoutGroup, t);
    if (problem) {
      C2C.flash(problem, "bad");
      return;
    }
    var button = document.getElementById("checkout");
    button.disabled = true;
    var draft = draftFor(group.sellerId);
    var productIds = picked.map(function (line) { return line.product_id; });
    var result = await C2C.state.client.rpc("place_order", {
      details: {
        sellers: [{
          seller_id: group.sellerId,
          product_ids: productIds,
          fulfillment_method: draft.fulfillment_method,
          cvs_chain: draft.fulfillment_method === "cvs" ? draft.cvs_chain : "",
          contact_name: draft.contact_name.trim(),
          contact_phone: draft.contact_phone.replace(/\s/g, ""),
          fulfillment_detail: draft.fulfillment_detail.trim()
        }]
      }
    });
    if (result.error) {
      button.disabled = false;
      C2C.flash(C2C.errorText(result.error), "bad");
      return;
    }
    var payload = result.data || {};
    var orders = payload.orders || [];
    await C2C.prepare(orders.map(function (order) { return order.seller_name; }));
    productIds.forEach(function (id) { delete selectedMap[id]; });
    delete checkoutDraft[group.sellerId];
    activeSellerId = "";
    C2C.refreshCartCount();
    var list = orders.map(function (order) {
      return "<li>" + C2C.esc(order.order_no) + "　" + C2C.esc(t("sellerOf", { name: C2C.shown(order.seller_name || "") })) +
        "　" + C2C.esc(t("orderTotal")) + " " + C2C.esc(C2C.money(order.total)) +
        ' <span class="hint">(' + C2C.esc(t("itemsSubtotal")) + " " + C2C.esc(C2C.money(order.items_subtotal)) +
        " + " + C2C.esc(t("shippingFee")) + " " + C2C.esc(C2C.money(order.shipping_fee)) +
        " + " + C2C.esc(t("platformFee")) + " " + C2C.esc(C2C.money(order.platform_fee)) + ")</span></li>";
    }).join("");
    var more = await loadCartData();
    var moreLink = more.groups.length
      ? '<p><a class="btn ghost" href="#" id="back-after-place">' + C2C.esc(t("backToCart")) + "</a></p>"
      : "";
    app.innerHTML = '<section class="panel"><h1>' + C2C.esc(t("placedTitle")) + "</h1><p>" + C2C.esc(t("placedBody", { n: orders.length })) + '</p><ul class="items">' + list + '</ul>' +
      moreLink +
      '<p><a class="btn" href="' + C2C.esc(C2C.path("buyer/orders.html")) + '">' + C2C.esc(t("viewBuys")) + "</a></p></section>";
    C2C.flash(t("placedOk"));
    var back = document.getElementById("back-after-place");
    if (back) {
      back.addEventListener("click", function (event) {
        event.preventDefault();
        renderCart();
      });
    }
  });
}

async function renderCart() {
  captureDraft();
  var app = document.getElementById("app");
  var t = C2C.t;
  await loadCartData();
  if (!cartCache.lines.length) {
    activeSellerId = "";
    app.innerHTML = '<section class="panel"><h1>' + C2C.esc(t("cartTitle")) + "</h1><p>" + C2C.esc(t("cartEmpty")) + '</p><p><a class="btn" href="' + C2C.esc(C2C.path("index.html")) + '">' + C2C.esc(t("browse")) + "</a></p></section>";
    return;
  }
  if (activeSellerId) {
    var group = findGroup(activeSellerId);
    if (!group || !selectedLines(group).length) {
      activeSellerId = "";
    } else {
      renderSellerCheckout(app, t, group);
      return;
    }
  }
  renderOverview(app, t, cartCache.groups);
}
