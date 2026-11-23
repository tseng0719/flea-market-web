var accountsState = {
  rows: [],
  deletingId: null
};

window.C2CPage = async function () {
  if (!C2C.guard("admin")) return;
  C2C.alignMode("admin");
  var app = document.getElementById("app");
  var t = C2C.t;

  app.innerHTML =
    '<div class="page-head"><div><h1>' + C2C.esc(t("accountsTitle")) + '</h1><p class="hint">' + C2C.esc(t("accountsHint")) + "</p></div></div>" +
    '<div class="stats" id="account-stats"></div>' +
    '<form id="account-filters" class="filters admin-filters">' +
    '<label class="field">' + C2C.esc(t("accountsSearch")) + '<input name="q" placeholder="' + C2C.esc(t("accountsSearchPh")) + '"></label>' +
    '<label class="field">' + C2C.esc(t("accountsRoleFilter")) + '<select name="role">' +
    '<option value="">' + C2C.esc(t("all")) + "</option>" +
    '<option value="buyer">' + C2C.esc(t("buyerMode")) + "</option>" +
    '<option value="seller">' + C2C.esc(t("sellerMode")) + "</option>" +
    '<option value="admin">' + C2C.esc(t("adminMode")) + "</option>" +
    "</select></label>" +
    '<label class="field">' + C2C.esc(t("accountsStatusFilter")) + '<select name="status">' +
    '<option value="active">' + C2C.esc(t("accountsStatusActive")) + "</option>" +
    '<option value="deleted">' + C2C.esc(t("accountsStatusDeleted")) + "</option>" +
    '<option value="all">' + C2C.esc(t("all")) + "</option>" +
    "</select></label>" +
    '<div class="admin-filter-actions">' +
    '<button class="btn" type="submit">' + C2C.esc(t("search")) + "</button>" +
    '<button class="btn ghost" type="button" id="clear-account-filters">' + C2C.esc(t("clearFilters")) + "</button>" +
    "</div></form>" +
    '<section class="panel admin-table-panel">' +
    '<div class="table-wrap"><table class="admin-table accounts-table">' +
    "<thead><tr>" +
    "<th>" + C2C.esc(t("accountsName")) + "</th>" +
    "<th>" + C2C.esc(t("accountsEmail")) + "</th>" +
    "<th>" + C2C.esc(t("accountsRoles")) + "</th>" +
    "<th>" + C2C.esc(t("accountsPhone")) + "</th>" +
    "<th>" + C2C.esc(t("accountsCreated")) + "</th>" +
    '<th class="col-actions">' + C2C.esc(t("accountsActions")) + "</th>" +
    "</tr></thead><tbody id=\"accounts-body\"></tbody></table></div>" +
    '<p class="hint" id="accounts-empty" hidden>' + C2C.esc(t("accountsEmpty")) + "</p>" +
    "</section>" +
    '<section class="panel account-delete-panel" id="delete-panel" hidden></section>';

  var form = document.getElementById("account-filters");
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    paintAccounts(new FormData(form));
  });
  document.getElementById("clear-account-filters").addEventListener("click", function () {
    form.reset();
    accountsState.deletingId = null;
    paintAccounts(new FormData(form));
  });
  document.getElementById("accounts-body").addEventListener("change", function (event) {
    var input = event.target.closest("[data-role-toggle]");
    if (!input) return;
    toggleRole(input).catch(function (err) {
      input.checked = !input.checked;
      C2C.flash(C2C.errorText(err), "bad");
    });
  });
  document.getElementById("accounts-body").addEventListener("click", function (event) {
    var btn = event.target.closest("[data-delete-user]");
    if (!btn) return;
    accountsState.deletingId = btn.getAttribute("data-delete-user");
    paintDeletePanel();
    var panel = document.getElementById("delete-panel");
    if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.getElementById("delete-panel").addEventListener("click", function (event) {
    if (event.target.closest("#cancel-delete")) {
      accountsState.deletingId = null;
      paintDeletePanel();
      return;
    }
  });
  document.getElementById("delete-panel").addEventListener("submit", function (event) {
    var formEl = event.target.closest("#delete-form");
    if (!formEl) return;
    event.preventDefault();
    submitDelete(new FormData(formEl)).catch(function (err) {
      C2C.flash(C2C.errorText(err), "bad");
    });
  });

  await reloadAccounts();
  paintAccounts(new FormData(form));
};

async function reloadAccounts() {
  var profilesRes = await C2C.state.client
    .from("profiles")
    .select("id, email, display_name, phone, created_at, deleted_at, delete_reason")
    .order("created_at", { ascending: false });
  if (profilesRes.error) throw profilesRes.error;
  var rolesRes = await C2C.state.client.from("user_roles").select("user_id, role");
  if (rolesRes.error) throw rolesRes.error;

  var roleMap = {};
  (rolesRes.data || []).forEach(function (row) {
    if (!roleMap[row.user_id]) roleMap[row.user_id] = [];
    roleMap[row.user_id].push(row.role);
  });

  var texts = [];
  accountsState.rows = (profilesRes.data || []).map(function (profile) {
    texts.push(profile.display_name);
    var roles = (roleMap[profile.id] || []).slice().sort(function (a, b) {
      var rank = { buyer: 0, seller: 1, admin: 2 };
      return (rank[a] || 9) - (rank[b] || 9);
    });
    return {
      id: profile.id,
      email: profile.email || "",
      display_name: profile.display_name || "",
      phone: profile.phone || "",
      created_at: profile.created_at,
      deleted_at: profile.deleted_at || null,
      delete_reason: profile.delete_reason || "",
      roles: roles
    };
  });
  await C2C.prepare(texts);
}

function filteredAccounts(data) {
  var q = String(data.get("q") || "").trim().toLowerCase();
  var role = String(data.get("role") || "");
  var status = String(data.get("status") || "active");
  return accountsState.rows.filter(function (row) {
    if (status === "active" && row.deleted_at) return false;
    if (status === "deleted" && !row.deleted_at) return false;
    if (role && row.roles.indexOf(role) < 0) return false;
    if (!q) return true;
    var blob = [
      row.display_name,
      row.email,
      row.phone,
      row.delete_reason,
      C2C.shown(row.display_name)
    ].join(" ").toLowerCase();
    return blob.indexOf(q) >= 0;
  });
}

function paintStats(rows) {
  var t = C2C.t;
  var active = rows.filter(function (row) { return !row.deleted_at; });
  var buyers = active.filter(function (row) { return row.roles.indexOf("buyer") >= 0; }).length;
  var sellers = active.filter(function (row) { return row.roles.indexOf("seller") >= 0; }).length;
  var deleted = rows.filter(function (row) { return !!row.deleted_at; }).length;
  document.getElementById("account-stats").innerHTML =
    '<article class="stat"><span>' + C2C.esc(t("accountsTotal")) + "</span><strong>" + active.length + "</strong></article>" +
    '<article class="stat"><span>' + C2C.esc(t("buyerMode")) + "</span><strong>" + buyers + "</strong></article>" +
    '<article class="stat"><span>' + C2C.esc(t("sellerMode")) + "</span><strong>" + sellers + "</strong></article>" +
    '<article class="stat"><span>' + C2C.esc(t("accountsDeletedCount")) + "</span><strong>" + deleted + "</strong></article>";
}

function roleBadges(roles) {
  if (!roles.length) return '<span class="hint">—</span>';
  return roles.map(function (role) {
    return '<span class="badge role-' + C2C.esc(role) + '">' + C2C.esc(C2C.t(role === "seller" ? "sellerMode" : role === "admin" ? "adminMode" : "buyerMode")) + "</span>";
  }).join(" ");
}

function canDelete(row) {
  if (!row || row.deleted_at) return false;
  if (row.id === C2C.userId()) return false;
  if (String(row.email || "").toLowerCase() === "tsengpinghsuan@gmail.com") return false;
  if (row.roles.indexOf("admin") >= 0) return false;
  return true;
}

function roleToggles(row) {
  var t = C2C.t;
  if (row.deleted_at) {
    return '<div class="account-deleted-meta">' +
      '<span class="badge role-deleted">' + C2C.esc(t("accountsDeletedBadge")) + "</span>" +
      '<p class="hint">' + C2C.esc(C2C.when(row.deleted_at) || "—") + "</p>" +
      (row.delete_reason
        ? '<p class="hint">' + C2C.esc(t("accountsDeleteReasonLine", { reason: row.delete_reason })) + "</p>"
        : '<p class="hint">' + C2C.esc(t("accountsNoDeleteReason")) + "</p>") +
      "</div>";
  }
  var isSelf = row.id === C2C.userId();
  var hasAdmin = row.roles.indexOf("admin") >= 0;
  return '<div class="account-role-toggles">' +
    '<label class="check"><input type="checkbox" data-role-toggle="buyer" data-user="' + C2C.esc(row.id) + '"' +
      (row.roles.indexOf("buyer") >= 0 ? " checked" : "") + "> " + C2C.esc(t("buyerMode")) + "</label>" +
    '<label class="check"><input type="checkbox" data-role-toggle="seller" data-user="' + C2C.esc(row.id) + '"' +
      (row.roles.indexOf("seller") >= 0 ? " checked" : "") + "> " + C2C.esc(t("sellerMode")) + "</label>" +
    (hasAdmin
      ? '<span class="hint">' + C2C.esc(isSelf ? t("accountsAdminSelf") : t("accountsAdminLocked")) + "</span>"
      : "") +
    (canDelete(row)
      ? '<button class="btn ghost danger-text" type="button" data-delete-user="' + C2C.esc(row.id) + '">' + C2C.esc(t("accountsDelete")) + "</button>"
      : "") +
    "</div>";
}

function paintAccounts(data) {
  var t = C2C.t;
  var rows = filteredAccounts(data);
  paintStats(accountsState.rows);
  paintDeletePanel();
  var body = document.getElementById("accounts-body");
  var empty = document.getElementById("accounts-empty");
  if (!rows.length) {
    body.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  body.innerHTML = rows.map(function (row) {
    return '<tr class="' + (row.deleted_at ? "is-deleted" : "") + '">' +
      "<td><strong>" + C2C.esc(C2C.shown(row.display_name) || "—") + "</strong></td>" +
      "<td>" + C2C.esc(row.email || "—") + "</td>" +
      '<td class="col-roles">' + roleBadges(row.roles) + "</td>" +
      "<td>" + C2C.esc(row.phone || "—") + "</td>" +
      "<td>" + C2C.esc(C2C.when(row.created_at) || "—") + "</td>" +
      '<td class="col-actions">' + roleToggles(row) + "</td>" +
      "</tr>";
  }).join("");
}

function paintDeletePanel() {
  var t = C2C.t;
  var panel = document.getElementById("delete-panel");
  if (!panel) return;
  var row = accountsState.rows.find(function (item) { return item.id === accountsState.deletingId; });
  if (!row || !canDelete(row)) {
    accountsState.deletingId = null;
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }
  panel.hidden = false;
  panel.innerHTML =
    '<div class="spread"><h2>' + C2C.esc(t("accountsDeleteTitle")) + "</h2>" +
    '<button class="btn ghost" type="button" id="cancel-delete">' + C2C.esc(t("accountsDeleteCancel")) + "</button></div>" +
    '<p>' + C2C.esc(t("accountsDeleteLead", {
      name: C2C.shown(row.display_name) || "—",
      email: row.email || "—"
    })) + "</p>" +
    '<p class="hint">' + C2C.esc(t("accountsDeleteHint")) + "</p>" +
    '<form id="delete-form" class="account-delete-form">' +
    '<input type="hidden" name="user_id" value="' + C2C.esc(row.id) + '">' +
    '<label class="field">' + C2C.esc(t("accountsDeleteReason")) +
    '<textarea name="reason" maxlength="200" rows="3" placeholder="' + C2C.esc(t("accountsDeleteReasonPh")) + '"></textarea></label>' +
    '<div class="row"><button class="btn bad" type="submit">' + C2C.esc(t("accountsDeleteConfirm")) + "</button></div>" +
    "</form>";
}

async function submitDelete(data) {
  var t = C2C.t;
  var userId = String(data.get("user_id") || "");
  var reason = String(data.get("reason") || "").trim();
  var row = accountsState.rows.find(function (item) { return item.id === userId; });
  if (!row || !canDelete(row)) {
    C2C.flash(t("accountsDeleteBlocked"), "bad");
    return;
  }
  var saved = await C2C.state.client.rpc("admin_delete_account", {
    target_user: userId,
    reason: reason
  });
  if (saved.error) throw saved.error;
  accountsState.deletingId = null;
  await reloadAccounts();
  paintAccounts(new FormData(document.getElementById("account-filters")));
  C2C.flash(t("accountsDeletedFlash"));
}

async function toggleRole(input) {
  var userId = input.getAttribute("data-user");
  var role = input.getAttribute("data-role-toggle");
  var enabled = !!input.checked;
  var row = accountsState.rows.find(function (item) { return item.id === userId; });
  if (row && row.deleted_at) {
    input.checked = !enabled;
    C2C.flash(C2C.t("accountsDeletedBadge"), "bad");
    return;
  }
  var saved = await C2C.state.client.rpc("admin_set_role", {
    target_user: userId,
    target_role: role,
    enabled: enabled
  });
  if (saved.error) throw saved.error;
  if (row) {
    if (enabled && row.roles.indexOf(role) < 0) row.roles.push(role);
    if (!enabled) row.roles = row.roles.filter(function (item) { return item !== role; });
    row.roles.sort(function (a, b) {
      var rank = { buyer: 0, seller: 1, admin: 2 };
      return (rank[a] || 9) - (rank[b] || 9);
    });
  }
  paintAccounts(new FormData(document.getElementById("account-filters")));
  C2C.flash(C2C.t(enabled ? "accountsRoleOn" : "accountsRoleOff", {
    role: C2C.t(role === "seller" ? "sellerMode" : "buyerMode")
  }));
}
