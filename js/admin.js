window.C2CPage = async function () {
  if (!C2C.guard("admin")) return;
  C2C.alignMode("admin");
  var app = document.getElementById("app");
  var t = C2C.t;
  app.innerHTML = '<div class="page-head"><div><h1>' + C2C.esc(t("adminTitle")) + '</h1><p class="hint">' + C2C.esc(t("adminHint")) + "</p></div></div>" +
    '<form id="filters" class="filters"><label class="field">' + C2C.esc(t("colNo")) + '<input name="orderNo" placeholder="' + C2C.esc(t("phOrder")) + '"></label>' +
    '<label class="field">' + C2C.esc(t("status")) + '<select name="status"><option value="">' + C2C.esc(t("all")) + "</option><option value=\"pending_payment\">" + C2C.esc(t("status_pending_payment")) + "</option><option value=\"ready_to_ship\">" + C2C.esc(t("status_ready_to_ship")) + "</option><option value=\"shipped\">" + C2C.esc(t("status_shipped")) + "</option><option value=\"completed\">" + C2C.esc(t("status_completed")) + "</option><option value=\"canceled_by_buyer\">" + C2C.esc(t("status_canceled_by_buyer")) + "</option><option value=\"rejected_by_seller\">" + C2C.esc(t("status_rejected_by_seller")) + "</option><option value=\"incomplete\">" + C2C.esc(t("incomplete")) + "</option></select></label>" +
    '<label class="field">' + C2C.esc(t("buyerWord")) + '<input name="buyer" placeholder="' + C2C.esc(t("phPerson")) + '"></label>' +
    '<label class="field">' + C2C.esc(t("sellerWord")) + '<input name="seller" placeholder="' + C2C.esc(t("phPerson")) + '"></label>' +
    '<button class="btn" type="submit">' + C2C.esc(t("search")) + '</button></form><div id="results" class="stack"></div>';
  var form = document.getElementById("filters");
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    load(new FormData(form)).catch(function (err) {
      C2C.flash(C2C.errorText(err), "bad");
    });
  });
  await load(new FormData(form));
};

async function load(data) {
  var results = document.getElementById("results");
  var orders = await C2C.fetchOrders("admin", {
    orderNo: String(data.get("orderNo") || ""),
    status: String(data.get("status") || "")
  });
  var buyer = String(data.get("buyer") || "").trim().toLowerCase();
  var seller = String(data.get("seller") || "").trim().toLowerCase();
  function hit(record, text) {
    if (!text) return true;
    var name = ((record && record.display_name) || "").toLowerCase();
    var translated = C2C.shown((record && record.display_name) || "").toLowerCase();
    var email = ((record && record.email) || "").toLowerCase();
    return name.indexOf(text) >= 0 || translated.indexOf(text) >= 0 || email.indexOf(text) >= 0;
  }
  orders = orders.filter(function (order) {
    return hit(order.buyer, buyer) && hit(order.seller, seller);
  });
  results.innerHTML = orders.length
    ? orders.map(function (order) { return C2C.orderArticle(order, { who: "admin" }); }).join("")
    : '<section class="panel"><p>' + C2C.esc(C2C.t("noTx")) + "</p></section>";
}
