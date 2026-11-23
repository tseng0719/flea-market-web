var dashState = {
  orders: [],
  monthChart: null,
  statusChart: null
};

window.C2CPage = async function () {
  if (!C2C.guard("seller")) return;
  C2C.alignMode("seller");
  var app = document.getElementById("app");
  var t = C2C.t;
  dashState.orders = await C2C.fetchOrders("seller");

  app.innerHTML =
    '<div class="page-head"><div><h1>' + C2C.esc(t("dashTitle")) + '</h1><p class="hint">' + C2C.esc(t("dashHint")) + "</p></div>" +
    '<button class="btn secondary" id="export-csv" type="button">' + C2C.esc(t("csv")) + "</button></div>" +
    '<form id="dash-filters" class="filters admin-filters dash-filters">' +
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
    '<label class="field">' + C2C.esc(t("fulfillment")) + '<select name="fulfillment">' +
    '<option value="">' + C2C.esc(t("all")) + "</option>" +
    '<option value="cvs">' + C2C.esc(t("fulfill_cvs")) + "</option>" +
    '<option value="home">' + C2C.esc(t("fulfill_home")) + "</option>" +
    '<option value="delivery">' + C2C.esc(t("fulfill_delivery")) + "</option>" +
    "</select></label>" +
    '<label class="field">' + C2C.esc(t("dashMonth")) + '<select name="month">' + monthOptionsHtml() + "</select></label>" +
    '<label class="field">' + C2C.esc(t("adminMinAmount")) + '<input name="minAmount" type="number" min="0" step="1" placeholder="0"></label>' +
    '<label class="field">' + C2C.esc(t("adminMaxAmount")) + '<input name="maxAmount" type="number" min="0" step="1" placeholder="99999"></label>' +
    '<div class="admin-filter-actions">' +
    '<button class="btn" type="submit">' + C2C.esc(t("search")) + "</button>" +
    '<button class="btn ghost" type="button" id="clear-filters">' + C2C.esc(t("clearFilters")) + "</button>" +
    "</div></form>" +
    '<div id="dash-body"></div>';

  var form = document.getElementById("dash-filters");
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    renderDashboard(new FormData(form));
  });
  document.getElementById("clear-filters").addEventListener("click", function () {
    form.reset();
    renderDashboard(new FormData(form));
  });
  document.getElementById("export-csv").addEventListener("click", function () {
    var filtered = applyFilters(dashState.orders, new FormData(form));
    if (!filtered.length) {
      C2C.flash(t("noTx"), "bad");
      return;
    }
    C2C.downloadCsv("seller-transactions.csv", filtered);
    C2C.flash(t("csvExported", { n: filtered.length }));
  });

  renderDashboard(new FormData(form));
};

function sellerNet(order) {
  if (order.items_subtotal != null && order.items_subtotal !== "") {
    return Math.max(0, Number(order.items_subtotal) || 0);
  }
  return Math.max(0, Number(order.total || 0) - Number(order.shipping_fee || 0) - Number(order.platform_fee || 0));
}

function sumNet(list) {
  return list.reduce(function (total, order) { return total + sellerNet(order); }, 0);
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

function monthOptionsHtml() {
  var t = C2C.t;
  var keys = recentMonthKeys(12);
  return '<option value="">' + C2C.esc(t("all")) + "</option>" + keys.map(function (key) {
    return '<option value="' + C2C.esc(key) + '">' + C2C.esc(C2C.monthLabel(key)) + "</option>";
  }).join("");
}

function hitPerson(record, text) {
  if (!text) return true;
  var name = ((record && record.display_name) || "").toLowerCase();
  var translated = C2C.shown((record && record.display_name) || "").toLowerCase();
  var email = ((record && record.email) || "").toLowerCase();
  return name.indexOf(text) >= 0 || translated.indexOf(text) >= 0 || email.indexOf(text) >= 0;
}

function applyFilters(orders, data) {
  var orderNo = String(data.get("orderNo") || "").trim().toLowerCase();
  var status = String(data.get("status") || "");
  var buyer = String(data.get("buyer") || "").trim().toLowerCase();
  var fulfillment = String(data.get("fulfillment") || "");
  var month = String(data.get("month") || "");
  var minRaw = data.get("minAmount");
  var maxRaw = data.get("maxAmount");
  var minAmount = minRaw === "" || minRaw == null ? null : Number(minRaw);
  var maxAmount = maxRaw === "" || maxRaw == null ? null : Number(maxRaw);

  return (orders || []).filter(function (order) {
    if (orderNo && String(order.order_no || "").toLowerCase().indexOf(orderNo) < 0) return false;
    if (status === "incomplete") {
      if (["pending_payment", "ready_to_ship", "shipped"].indexOf(order.status) < 0) return false;
    } else if (status && order.status !== status) {
      return false;
    }
    if (!hitPerson(order.buyer, buyer)) return false;
    if (fulfillment && order.fulfillment_method !== fulfillment) return false;
    if (month) {
      var stamp = order.status === "completed" ? order.completed_at : order.created_at;
      if (C2C.monthKey(stamp) !== month) return false;
    }
    var net = sellerNet(order);
    if (minAmount != null && Number.isFinite(minAmount) && net < minAmount) return false;
    if (maxAmount != null && Number.isFinite(maxAmount) && net > maxAmount) return false;
    return true;
  });
}

function destroyCharts() {
  if (dashState.monthChart) {
    dashState.monthChart.destroy();
    dashState.monthChart = null;
  }
  if (dashState.statusChart) {
    dashState.statusChart.destroy();
    dashState.statusChart = null;
  }
}

function renderDashboard(data) {
  var t = C2C.t;
  var filtered = applyFilters(dashState.orders, data);
  var currentMonth = C2C.monthKey(new Date().toISOString());
  var filterMonth = String(data.get("month") || "");
  var revMonth = filterMonth || currentMonth;

  function byStatus(status) {
    return filtered.filter(function (order) { return order.status === status; });
  }

  var completed = byStatus("completed");
  var monthOrders = completed.filter(function (order) { return C2C.monthKey(order.completed_at) === revMonth; });
  var pending = byStatus("pending_payment");
  var waiting = byStatus("ready_to_ship");
  var shipped = byStatus("shipped");
  var monthKeys = recentMonthKeys(6);
  var monthTotals = monthKeys.map(function (key) {
    return sumNet(completed.filter(function (order) { return C2C.monthKey(order.completed_at) === key; }));
  });
  var statusLabels = [
    t("status_pending_payment"),
    t("status_ready_to_ship"),
    t("status_shipped"),
    t("status_completed"),
    t("status_canceled_by_buyer"),
    t("status_rejected_by_seller")
  ];
  var statusCounts = [
    pending.length,
    waiting.length,
    shipped.length,
    completed.length,
    byStatus("canceled_by_buyer").length,
    byStatus("rejected_by_seller").length
  ];

  var history = completed.map(function (order) {
    var buyer = order.buyer ? C2C.shown(order.buyer.display_name) : "—";
    return "<tr><td>" + C2C.esc(order.order_no) + "</td><td>" + C2C.esc(C2C.when(order.completed_at) || "—") + "</td><td>" + C2C.esc(buyer) + "</td><td>" + C2C.esc(C2C.money(sellerNet(order))) + "</td></tr>";
  }).join("");

  destroyCharts();
  document.getElementById("dash-body").innerHTML =
    '<p class="hint dash-filter-result">' + C2C.esc(t("dashFilterResult", { n: filtered.length })) + "</p>" +
    '<div class="stats">' +
    '<article class="stat"><span>' + C2C.esc(t("monthRev", { month: C2C.monthLabel(revMonth) })) + "</span><strong>" + C2C.esc(C2C.money(sumNet(monthOrders))) + '</strong><span class="hint">' + C2C.esc(t("dashNetNote")) + "</span></article>" +
    '<article class="stat"><span>' + C2C.esc(t("doneCount")) + "</span><strong>" + completed.length + "</strong></article>" +
    '<article class="stat"><span>' + C2C.esc(t("pendingCount")) + "</span><strong>" + C2C.esc(t("countYuan", { n: pending.length })) + '</strong><span class="hint">' + C2C.esc(C2C.money(sumNet(pending))) + "</span></article>" +
    '<article class="stat"><span>' + C2C.esc(t("shipCount")) + "</span><strong>" + C2C.esc(t("countYuan", { n: waiting.length })) + '</strong><span class="hint">' + C2C.esc(C2C.money(sumNet(waiting))) + "</span></article>" +
    "</div>" +
    '<div class="dash-charts">' +
    '<section class="panel dash-chart-panel"><h2>' + C2C.esc(t("chartMonthTitle")) + '</h2><p class="hint">' + C2C.esc(t("chartMonthHint")) + '</p><div class="dash-chart-wrap"><canvas id="month-chart" aria-label="' + C2C.esc(t("chartMonthTitle")) + '"></canvas></div></section>' +
    '<section class="panel dash-chart-panel"><h2>' + C2C.esc(t("chartStatusTitle")) + '</h2><p class="hint">' + C2C.esc(t("chartStatusHint")) + '</p><div class="dash-chart-wrap dash-chart-wrap-doughnut"><canvas id="status-chart" aria-label="' + C2C.esc(t("chartStatusTitle")) + '"></canvas></div></section>' +
    "</div>" +
    '<section class="panel"><h2>' + C2C.esc(t("sales")) + "</h2>" +
    (history
      ? "<table><thead><tr><th>" + C2C.esc(t("colNo")) + "</th><th>" + C2C.esc(t("colDone")) + "</th><th>" + C2C.esc(t("colBuyer")) + "</th><th>" + C2C.esc(t("colSellerNet")) + "</th></tr></thead><tbody>" + history + "</tbody></table>"
      : "<p>" + C2C.esc(t("noDone")) + "</p>") +
    '<p><a href="' + C2C.esc(C2C.path("seller/orders.html")) + '">' + C2C.esc(t("toProcess")) + "</a></p></section>";

  paintCharts(monthKeys, monthTotals, statusLabels, statusCounts);
}

function paintCharts(monthKeys, monthTotals, statusLabels, statusCounts) {
  if (!window.Chart) return;
  var t = C2C.t;
  var labels = monthKeys.map(function (key) { return C2C.monthLabel(key); });
  var accent = "#1f6fd6";
  var colors = ["#9a6a1a", accent, "#433878", "#3f7d68", "#c25555", "#a06060"];

  dashState.monthChart = new Chart(document.getElementById("month-chart"), {
    type: "bar",
    data: {
      labels: labels,
      datasets: [{
        label: t("chartMonthSeries"),
        data: monthTotals,
        backgroundColor: "rgba(31, 111, 214, 0.72)",
        borderColor: accent,
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
  dashState.statusChart = new Chart(document.getElementById("status-chart"), {
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
