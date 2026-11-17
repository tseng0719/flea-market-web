window.C2CPage = async function () {
  if (!C2C.guard("seller")) return;
  C2C.alignMode("seller");
  var app = document.getElementById("app");
  var t = C2C.t;
  var orders = await C2C.fetchOrders("seller");
  var month = C2C.monthKey(new Date().toISOString());
  function sum(list) {
    return list.reduce(function (total, order) { return total + Number(order.total || 0); }, 0);
  }
  function count(status) {
    return orders.filter(function (order) { return order.status === status; });
  }
  var completed = count("completed");
  var monthOrders = completed.filter(function (order) { return C2C.monthKey(order.completed_at) === month; });
  var pending = count("pending_payment");
  var waiting = count("ready_to_ship");
  var history = completed.map(function (order) {
    var buyer = order.buyer ? C2C.shown(order.buyer.display_name) : "—";
    return "<tr><td>" + C2C.esc(order.order_no) + "</td><td>" + C2C.esc(C2C.when(order.completed_at) || "—") + "</td><td>" + C2C.esc(buyer) + "</td><td>" + C2C.esc(C2C.money(order.total)) + "</td></tr>";
  }).join("");
  app.innerHTML = '<div class="page-head"><div><h1>' + C2C.esc(t("dashTitle")) + '</h1><p class="hint">' + C2C.esc(t("dashHint")) + '</p></div><button class="btn secondary" id="export-csv" type="button">' + C2C.esc(t("csv")) + "</button></div>" +
    '<div class="stats"><article class="stat"><span>' + C2C.esc(t("monthRev", { month: C2C.monthLabel(month) })) + '</span><strong>' + C2C.esc(C2C.money(sum(monthOrders))) + "</strong></article>" +
    '<article class="stat"><span>' + C2C.esc(t("doneCount")) + "</span><strong>" + completed.length + "</strong></article>" +
    '<article class="stat"><span>' + C2C.esc(t("pendingCount")) + "</span><strong>" + C2C.esc(t("countYuan", { n: pending.length })) + '</strong><span class="hint">' + C2C.esc(C2C.money(sum(pending))) + "</span></article>" +
    '<article class="stat"><span>' + C2C.esc(t("shipCount")) + "</span><strong>" + C2C.esc(t("countYuan", { n: waiting.length })) + '</strong><span class="hint">' + C2C.esc(C2C.money(sum(waiting))) + "</span></article></div>" +
    '<section class="panel"><h2>' + C2C.esc(t("sales")) + "</h2>" +
    (history ? "<table><thead><tr><th>" + C2C.esc(t("colNo")) + "</th><th>" + C2C.esc(t("colDone")) + "</th><th>" + C2C.esc(t("colBuyer")) + "</th><th>" + C2C.esc(t("colAmount")) + "</th></tr></thead><tbody>" + history + "</tbody></table>" : "<p>" + C2C.esc(t("noDone")) + "</p>") +
    '<p><a href="' + C2C.esc(C2C.path("seller/orders.html")) + '">' + C2C.esc(t("toProcess")) + "</a></p></section>";
  document.getElementById("export-csv").addEventListener("click", function () {
    C2C.downloadCsv("seller-transactions.csv", orders);
  });
};
