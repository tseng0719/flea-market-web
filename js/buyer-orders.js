window.C2CPage = async function () {
  if (!C2C.guard("buyer")) return;
  C2C.alignMode("buyer");
  var app = document.getElementById("app");
  C2C.bindOrderActions(app, loadOrders);
  await loadOrders();
};

async function loadOrders() {
  var app = document.getElementById("app");
  var t = C2C.t;
  var orders = await C2C.fetchOrders("buyer");
  var cards = orders.map(function (order) {
    return C2C.orderArticle(order, { who: "buyer", actions: true });
  }).join("");
  app.innerHTML = '<div class="page-head"><div><h1>' + C2C.esc(t("ordersTitle")) + '</h1><p class="hint">' + C2C.esc(t("ordersHint")) + "</p></div></div>" +
    (cards ? '<div class="stack">' + cards + "</div>" : '<section class="panel"><p>' + C2C.esc(t("noBuys")) + "</p></section>");
}
