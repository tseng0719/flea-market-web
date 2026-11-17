window.C2CPage = async function () {
  if (!C2C.guard("seller")) return;
  C2C.alignMode("seller");
  var app = document.getElementById("app");
  C2C.bindOrderActions(app, loadOrders);
  await loadOrders();
};

async function loadOrders() {
  var app = document.getElementById("app");
  var t = C2C.t;
  var orders = await C2C.fetchOrders("seller");
  var groups = [
    ["pending_payment", t("status_pending_payment")],
    ["ready_to_ship", t("status_ready_to_ship")],
    ["shipped", t("status_shipped")],
    ["completed", t("sales")],
    ["canceled_by_buyer", t("status_canceled_by_buyer")],
    ["rejected_by_seller", t("status_rejected_by_seller")]
  ];
  var html = groups.map(function (group) {
    var cards = orders.filter(function (order) { return order.status === group[0]; }).map(function (order) {
      return C2C.orderArticle(order, { who: "seller", actions: true });
    }).join("");
    return "<section><h2>" + C2C.esc(group[1]) + "</h2>" + (cards || '<p class="hint">' + C2C.esc(t("none")) + "</p>") + "</section>";
  }).join("");
  app.innerHTML = '<div class="page-head"><div><h1>' + C2C.esc(t("processTitle")) + '</h1><p class="hint">' + C2C.esc(t("processHint")) + '</p></div><button class="btn secondary" id="export-csv" type="button">' + C2C.esc(t("csv")) + '</button></div><div class="stack">' + html + "</div>";
  document.getElementById("export-csv").addEventListener("click", function () {
    C2C.downloadCsv("seller-transactions.csv", orders);
  });
}
