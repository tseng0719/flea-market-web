var adminState = {
  allOrders: [],
  orders: [],
  selected: {},
  detailId: null,
  feeChart: null,
  statusChart: null
};

window.C2CPage = async function () {
  if (!C2C.guard("admin")) return;
  C2C.alignMode("admin");
  var app = document.getElementById("app");
  var t = C2C.t;
  app.innerHTML =
    '<div id="list-view">' +
    '<div class="page-head"><div><h1>' + C2C.esc(t("adminTitle")) + '</h1><p class="hint">' + C2C.esc(t("adminHintTable")) + "</p></div></div>" +
    '<div class="stats" id="admin-fee-stats"></div>' +
    '<form id="filters" class="filters admin-filters">' +
    '<label class="field">' + C2C.esc(t("colNo")) + '<input name="orderNo" placeholder="' + C2C.esc(t("phOrder")) + '"></label>' +
    '<label class="field">' + C2C.esc(t("status")) + '<select name="status">' +
    '<option value="">' + C2C.esc(t("all")) + "</option>" +
    '<option value="pending_payment">' + C2C.esc(t("status_pending_payment")) + "</option>" +
    '<option value="ready_to_ship">' + C2C.esc(t("status_ready_to_ship")) + "</option>" +
    '<option value="shipped">' + C2C.esc(t("status_shipped")) + "</option>" +
    '<option value="completed">' + C2C.esc(t("status_completed")) + "</option>" +
    '<option value="canceled_by_buyer">' + C2C.esc(t("status_canceled_by_buyer")) + "</option>" +
    '<option value="rejected_by_seller">' + C2C.esc(t("status_rejected_by_seller")) + "</option>" +
    '<option value="incomplete">' + C2C.esc(t("incomplete")) + "</option>" +
    "</select></label>" +
    '<label class="field">' + C2C.esc(t("buyerWord")) + '<input name="buyer" placeholder="' + C2C.esc(t("phPerson")) + '"></label>' +
    '<label class="field">' + C2C.esc(t("sellerWord")) + '<input name="seller" placeholder="' + C2C.esc(t("phPerson")) + '"></label>' +
    '<label class="field">' + C2C.esc(t("fulfillment")) + '<select name="fulfillment">' +
    '<option value="">' + C2C.esc(t("all")) + "</option>" +
    '<option value="cvs">' + C2C.esc(t("fulfill_cvs")) + "</option>" +
    '<option value="home">' + C2C.esc(t("fulfill_home")) + "</option>" +
    '<option value="delivery">' + C2C.esc(t("fulfill_delivery")) + "</option>" +
    "</select></label>" +
    '<label class="field">' + C2C.esc(t("adminMinAmount")) + '<input name="minAmount" type="number" min="0" step="1" placeholder="0"></label>' +
    '<label class="field">' + C2C.esc(t("adminMaxAmount")) + '<input name="maxAmount" type="number" min="0" step="1" placeholder="99999"></label>' +
    '<div class="admin-filter-actions">' +
    '<button class="btn" type="submit">' + C2C.esc(t("search")) + "</button>" +
    '<button class="btn ghost" type="button" id="clear-filters">' + C2C.esc(t("clearFilters")) + "</button>" +
    "</div></form>" +
    '<div class="dash-charts" id="admin-charts">' +
    '<section class="panel dash-chart-panel"><h2>' + C2C.esc(t("adminChartFeeTitle")) + '</h2><p class="hint">' + C2C.esc(t("adminChartFeeHint")) + '</p><div class="dash-chart-wrap"><canvas id="admin-fee-chart" aria-label="' + C2C.esc(t("adminChartFeeTitle")) + '"></canvas></div></section>' +
    '<section class="panel dash-chart-panel"><h2>' + C2C.esc(t("adminChartStatusTitle")) + '</h2><p class="hint">' + C2C.esc(t("adminChartStatusHint")) + '</p><div class="dash-chart-wrap dash-chart-wrap-doughnut"><canvas id="admin-status-chart" aria-label="' + C2C.esc(t("adminChartStatusTitle")) + '"></canvas></div></section>' +
    "</div>" +
    '<section class="panel admin-table-panel">' +
    '<div class="admin-table-toolbar">' +
    '<div class="admin-toolbar-left">' +
    '<label class="check"><input type="checkbox" id="select-all"> ' + C2C.esc(t("selectAllRows")) + "</label>" +
    '<p class="hint" id="selection-hint">' + C2C.esc(t("selectedCount", { n: 0 })) + "</p>" +
    "</div>" +
    '<button class="btn secondary btn-icon" id="export-selected" type="button" disabled>' + C2C.withIcon("checkout", t("exportSelectedCsv")) + "</button>" +
    "</div>" +
    '<div class="table-wrap"><table class="admin-table" id="admin-table">' +
    "<thead><tr>" +
    '<th class="col-check"></th>' +
    '<th class="col-no">' + C2C.esc(t("csvNo")) + "</th>" +
    '<th class="col-time">' + C2C.esc(t("csvTime")) + "</th>" +
    '<th class="col-person">' + C2C.esc(t("csvBuyer")) + "</th>" +
    '<th class="col-person">' + C2C.esc(t("csvSeller")) + "</th>" +
    '<th class="col-status">' + C2C.esc(t("csvStatus")) + "</th>" +
    '<th class="col-amount">' + C2C.esc(t("csvAmount")) + "</th>" +
    '<th class="col-fee">' + C2C.esc(t("csvPlatformFee")) + "</th>" +
    '<th class="col-fulfill">' + C2C.esc(t("csvFulfill")) + "</th>" +
    "</tr></thead><tbody id=\"results-body\"></tbody></table></div>" +
    '<p class="hint" id="empty-hint" hidden>' + C2C.esc(t("noTx")) + "</p>" +
    "</section></div>" +
    '<div id="detail-view" class="admin-detail-view" hidden>' +
    '<div class="page-head admin-detail-head">' +
    '<button class="btn ghost btn-icon" id="back-to-list" type="button">' + C2C.withIcon("back", t("backToTxList")) + "</button>" +
    '<div><h1>' + C2C.esc(t("adminOrderDetail")) + '</h1><p class="hint">' + C2C.esc(t("adminDetailHint")) + "</p></div>" +
    "</div>" +
    '<div id="detail-body"></div></div>';

  var form = document.getElementById("filters");
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    load(new FormData(form)).catch(function (err) {
      C2C.flash(C2C.errorText(err), "bad");
    });
  });
  document.getElementById("clear-filters").addEventListener("click", function () {
    form.reset();
    adminState.selected = {};
    load(new FormData(form)).catch(function (err) {
      C2C.flash(C2C.errorText(err), "bad");
    });
  });
  document.getElementById("select-all").addEventListener("change", function () {
    var on = !!document.getElementById("select-all").checked;
    adminState.orders.forEach(function (order) {
      adminState.selected[order.id] = on;
    });
    paintSelection();
  });
  document.getElementById("export-selected").addEventListener("click", function () {
    var picked = adminState.orders.filter(function (order) { return !!adminState.selected[order.id]; });
    if (!picked.length) {
      C2C.flash(t("needSelectRows"), "bad");
      return;
    }
    C2C.downloadOrdersCsv("admin-transactions-selected.csv", picked);
    C2C.flash(t("csvExported", { n: picked.length }));
  });
  document.getElementById("results-body").addEventListener("change", function (event) {
    var input = event.target.closest("[data-select-order]");
    if (!input) return;
    adminState.selected[input.getAttribute("data-select-order")] = !!input.checked;
    paintSelection();
  });
  document.getElementById("results-body").addEventListener("click", function (event) {
    if (event.target.closest("[data-select-order]") || event.target.closest("label.check")) return;
    var row = event.target.closest("[data-open-order]");
    if (!row) return;
    openDetail(row.getAttribute("data-open-order"));
  });
  document.getElementById("back-to-list").addEventListener("click", function () {
    closeDetail();
  });

  await load(new FormData(form));
};

function hitPerson(record, text) {
  if (!text) return true;
  var name = ((record && record.display_name) || "").toLowerCase();
  var translated = C2C.shown((record && record.display_name) || "").toLowerCase();
  var email = ((record && record.email) || "").toLowerCase();
  return name.indexOf(text) >= 0 || translated.indexOf(text) >= 0 || email.indexOf(text) >= 0;
}

function personCell(record) {
  if (!record) return '<span class="admin-person-name">—</span>';
  var name = C2C.shown(record.display_name || "") || "—";
  var html = '<span class="admin-person-name">' + C2C.esc(name) + "</span>";
  if (record.email) {
    html += '<span class="admin-person-email">' + C2C.esc(record.email) + "</span>";
  }
  return html;
}

function selectedIds() {
  return adminState.orders.filter(function (order) { return !!adminState.selected[order.id]; }).map(function (order) { return order.id; });
}

function platformFeeOf(order) {
  return Math.max(0, Number(order && order.platform_fee != null ? order.platform_fee : 0) || 0);
}

function sumPlatformFees(list) {
  return (list || []).reduce(function (total, order) { return total + platformFeeOf(order); }, 0);
}

function completedOrders(list) {
  return (list || []).filter(function (order) { return order.status === "completed"; });
}

function recentMonthKeys(n) {
  var key = C2C.monthKey(new Date().toISOString());
  var year = Number(key.slice(0, 4));
  var monthNum = Number(key.slice(5, 7));
  var keys = [];
  for (var i = n - 1; i >= 0; i -= 1) {
    var m = monthNum - i;
    var y = year;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    keys.push(y + "-" + (m < 10 ? "0" : "") + m);
  }
  return keys;
}

function destroyAdminCharts() {
  if (adminState.feeChart) {
    adminState.feeChart.destroy();
    adminState.feeChart = null;
  }
  if (adminState.statusChart) {
    adminState.statusChart.destroy();
    adminState.statusChart = null;
  }
}

function paintFeeStats(filtered) {
  var t = C2C.t;
  var month = C2C.monthKey(new Date().toISOString());
  var allCompleted = completedOrders(adminState.allOrders);
  var monthFees = sumPlatformFees(allCompleted.filter(function (order) {
    return C2C.monthKey(order.completed_at) === month;
  }));
  var filteredCompleted = completedOrders(filtered);
  var el = document.getElementById("admin-fee-stats");
  if (!el) return;
  el.innerHTML =
    '<article class="stat"><span>' + C2C.esc(t("adminFeeTotal")) + "</span><strong>" + C2C.esc(C2C.money(sumPlatformFees(allCompleted))) + '</strong><span class="hint">' + C2C.esc(t("adminFeeHint")) + "</span></article>" +
    '<article class="stat"><span>' + C2C.esc(t("adminFeeMonth", { month: C2C.monthLabel(month) })) + "</span><strong>" + C2C.esc(C2C.money(monthFees)) + "</strong></article>" +
    '<article class="stat"><span>' + C2C.esc(t("adminFeeOrders")) + "</span><strong>" + allCompleted.length + "</strong></article>" +
    '<article class="stat"><span>' + C2C.esc(t("adminFeeFiltered")) + "</span><strong>" + C2C.esc(C2C.money(sumPlatformFees(filteredCompleted))) + '</strong><span class="hint">' + C2C.esc(t("countYuan", { n: filteredCompleted.length })) + "</span></article>";
}

function paintAdminCharts(filtered) {
  if (!window.Chart) return;
  var t = C2C.t;
  var completed = completedOrders(filtered);
  var monthKeys = recentMonthKeys(6);
  var monthTotals = monthKeys.map(function (key) {
    return sumPlatformFees(completed.filter(function (order) {
      return C2C.monthKey(order.completed_at) === key;
    }));
  });
  var statusKeys = [
    "pending_payment",
    "ready_to_ship",
    "shipped",
    "completed",
    "canceled_by_buyer",
    "rejected_by_seller"
  ];
  var statusLabels = statusKeys.map(function (key) { return t("status_" + key); });
  var statusCounts = statusKeys.map(function (key) {
    return filtered.filter(function (order) { return order.status === key; }).length;
  });

  destroyAdminCharts();

  var feeCanvas = document.getElementById("admin-fee-chart");
  var statusCanvas = document.getElementById("admin-status-chart");
  if (!feeCanvas || !statusCanvas) return;

  var green = "#3f7d68";
  var accent = "#1f6fd6";
  var colors = ["#9a6a1a", accent, "#433878", green, "#c25555", "#a06060"];

  adminState.feeChart = new Chart(feeCanvas, {
    type: "bar",
    data: {
      labels: monthKeys.map(function (key) { return C2C.monthLabel(key); }),
      datasets: [{
        label: t("adminChartFeeSeries"),
        data: monthTotals,
        backgroundColor: "rgba(63, 125, 104, 0.75)",
        borderColor: green,
        borderWidth: 1,
        borderRadius: 8,
        maxBarThickness: 42
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 900, easing: "easeOutQuart" },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (ctx) {
              return C2C.money(ctx.parsed.y || 0);
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#7a8798", maxRotation: 0 }
        },
        y: {
          beginAtZero: true,
          grid: { color: "#e5edf6" },
          ticks: {
            color: "#7a8798",
            callback: function (value) {
              return "NT$ " + Number(value).toLocaleString("zh-TW");
            }
          }
        }
      }
    }
  });

  var hasStatus = statusCounts.some(function (n) { return n > 0; });
  adminState.statusChart = new Chart(statusCanvas, {
    type: "doughnut",
    data: {
      labels: statusLabels,
      datasets: [{
        data: hasStatus ? statusCounts : [1],
        backgroundColor: hasStatus ? colors : ["#e5edf6"],
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "58%",
      animation: { animateRotate: true, duration: 900 },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            boxWidth: 12,
            color: "#243247",
            font: { size: 12 }
          }
        },
        tooltip: {
          callbacks: {
            label: function (ctx) {
              if (!hasStatus) return t("chartEmpty");
              return ctx.label + ": " + ctx.parsed;
            }
          }
        }
      }
    }
  });
}

function paintSelection() {
  var t = C2C.t;
  var ids = selectedIds();
  var all = adminState.orders.length > 0 && ids.length === adminState.orders.length;
  var selectAll = document.getElementById("select-all");
  if (selectAll) {
    selectAll.checked = all;
    selectAll.indeterminate = ids.length > 0 && !all;
  }
  document.querySelectorAll("[data-select-order]").forEach(function (input) {
    input.checked = !!adminState.selected[input.getAttribute("data-select-order")];
  });
  var hint = document.getElementById("selection-hint");
  if (hint) hint.textContent = t("selectedCount", { n: ids.length });
  var exportBtn = document.getElementById("export-selected");
  if (exportBtn) exportBtn.disabled = ids.length === 0;
}

function openDetail(orderId) {
  var order = adminState.orders.find(function (item) { return item.id === orderId; });
  if (!order) {
    C2C.flash(C2C.t("orderNotFound"), "bad");
    return;
  }
  adminState.detailId = orderId;
  document.getElementById("list-view").hidden = true;
  var detail = document.getElementById("detail-view");
  detail.hidden = false;
  document.getElementById("detail-body").innerHTML = C2C.orderArticle(order, { who: "admin", actions: false });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeDetail() {
  adminState.detailId = null;
  document.getElementById("detail-view").hidden = true;
  document.getElementById("list-view").hidden = false;
  document.getElementById("detail-body").innerHTML = "";
}

async function load(data) {
  var t = C2C.t;
  adminState.allOrders = await C2C.fetchOrders("admin", {});
  var orderNo = String(data.get("orderNo") || "").trim().toLowerCase();
  var status = String(data.get("status") || "");
  var buyer = String(data.get("buyer") || "").trim().toLowerCase();
  var seller = String(data.get("seller") || "").trim().toLowerCase();
  var fulfillment = String(data.get("fulfillment") || "");
  var minRaw = data.get("minAmount");
  var maxRaw = data.get("maxAmount");
  var minAmount = minRaw === "" || minRaw == null ? null : Number(minRaw);
  var maxAmount = maxRaw === "" || maxRaw == null ? null : Number(maxRaw);

  var orders = adminState.allOrders.filter(function (order) {
    if (orderNo && String(order.order_no || "").toLowerCase().indexOf(orderNo) < 0) return false;
    if (status === "incomplete") {
      if (["pending_payment", "ready_to_ship", "shipped"].indexOf(order.status) < 0) return false;
    } else if (status && order.status !== status) {
      return false;
    }
    if (!hitPerson(order.buyer, buyer)) return false;
    if (!hitPerson(order.seller, seller)) return false;
    if (fulfillment && order.fulfillment_method !== fulfillment) return false;
    var total = Number(order.total || 0);
    if (minAmount != null && Number.isFinite(minAmount) && total < minAmount) return false;
    if (maxAmount != null && Number.isFinite(maxAmount) && total > maxAmount) return false;
    return true;
  });

  var keep = {};
  orders.forEach(function (order) {
    if (adminState.selected[order.id]) keep[order.id] = true;
  });
  adminState.selected = keep;
  adminState.orders = orders;
  paintFeeStats(orders);
  paintAdminCharts(orders);

  var body = document.getElementById("results-body");
  var empty = document.getElementById("empty-hint");
  if (!orders.length) {
    body.innerHTML = "";
    empty.hidden = false;
    paintSelection();
    if (adminState.detailId) closeDetail();
    return;
  }
  empty.hidden = true;
  body.innerHTML = orders.map(function (order) {
    var checked = adminState.selected[order.id] ? " checked" : "";
    var method = order.fulfillment_method ? C2C.fulfillmentLabel(order) : "—";
    var fee = order.status === "completed" ? C2C.money(platformFeeOf(order)) : "—";
    return '<tr class="admin-row" data-open-order="' + C2C.esc(order.id) + '" tabindex="0">' +
      '<td class="col-check"><input type="checkbox" data-select-order="' + C2C.esc(order.id) + '"' + checked + "></td>" +
      '<td class="col-no"><button class="admin-order-link" type="button" data-open-order="' + C2C.esc(order.id) + '"><code>' + C2C.esc(order.order_no) + "</code></button></td>" +
      '<td class="col-time">' + C2C.esc(C2C.when(order.created_at) || "—") + "</td>" +
      '<td class="col-person">' + personCell(order.buyer) + "</td>" +
      '<td class="col-person">' + personCell(order.seller) + "</td>" +
      '<td class="col-status"><span class="badge ' + C2C.esc(order.status) + '">' + C2C.esc(C2C.statusText(order.status)) + "</span></td>" +
      '<td class="col-amount">' + C2C.esc(C2C.money(order.total)) + "</td>" +
      '<td class="col-fee">' + C2C.esc(fee) + "</td>" +
      '<td class="col-fulfill">' + C2C.esc(method) + "</td>" +
      "</tr>";
  }).join("");
  paintSelection();
  if (adminState.detailId && !orders.some(function (order) { return order.id === adminState.detailId; })) {
    closeDetail();
  }
}
