var ADMIN_EMAIL = "tsengpinghsuan@gmail.com";

window.C2CPage = async function () {
  var app = document.getElementById("app");
  var t = C2C.t;
  var isRegister = document.body.getAttribute("data-page") === "register";
  if (C2C.state.session) {
    location.href = C2C.path("index.html");
    return;
  }
  if (!C2C.configured()) {
    app.innerHTML = '<section class="panel"><h1>' + C2C.esc(isRegister ? t("navRegister") : t("navLogin")) + "</h1><p>" + C2C.esc(t("authNeed")) + "</p></section>";
    return;
  }

  if (!isRegister) {
    app.innerHTML = '<section class="panel auth-panel"><h1>' + C2C.esc(t("navLogin")) + '</h1><p class="hint">' + C2C.esc(t("loginHint")) + '</p><form id="auth-form" class="form">' +
      '<label class="field">' + C2C.esc(t("email")) + '<input name="email" type="email" required autocomplete="username"></label>' +
      '<label class="field">' + C2C.esc(t("password")) + '<input name="password" type="password" minlength="6" required autocomplete="current-password"></label>' +
      '<button class="btn" type="submit">' + C2C.esc(t("signIn")) + "</button></form>" +
      '<p class="hint auth-switch"><a href="' + C2C.esc(C2C.path("forgot-password.html")) + '">' + C2C.esc(t("forgotLink")) + "</a></p>" +
      '<p class="hint auth-switch">' + C2C.esc(t("noAccount")) + ' <a href="' + C2C.esc(C2C.path("register.html")) + '">' + C2C.esc(t("navRegister")) + "</a></p></section>";
    bindLogin();
    return;
  }

  app.innerHTML =
    '<div class="page-head"><div><h1>' + C2C.esc(t("registerTitle")) + '</h1><p class="hint">' + C2C.esc(t("registerLead")) + "</p></div></div>" +
    '<div class="register-layout">' +
    memberCard("buyer", t) +
    memberCard("seller", t) +
    '<section class="panel register-card register-card-admin">' +
    "<h2>" + C2C.esc(t("adminRegisterTitle")) + "</h2>" +
    '<p class="hint">' + C2C.esc(t("adminRegisterHint")) + "</p>" +
    '<form id="admin-form" class="form">' +
    '<label class="field">' + C2C.esc(t("displayName")) + '<input name="display_name" maxlength="40" required value="Demo" autocomplete="nickname"></label>' +
    '<label class="field">' + C2C.esc(t("email")) + '<input name="email" type="email" required readonly value="' + C2C.esc(ADMIN_EMAIL) + '" autocomplete="username"></label>' +
    '<label class="field">' + C2C.esc(t("password")) + '<input name="password" type="password" minlength="6" required autocomplete="new-password"></label>' +
    '<p class="hint">' + C2C.esc(t("adminRolesNote")) + "</p>" +
    '<button class="btn secondary" type="submit">' + C2C.esc(t("createAdminAccount")) + "</button>" +
    "</form></section>" +
    "</div>" +
    '<p class="hint auth-switch">' + C2C.esc(t("haveAccount")) + ' <a href="' + C2C.esc(C2C.path("login.html")) + '">' + C2C.esc(t("navLogin")) + "</a></p>";

  bindRegister(document.getElementById("buyer-form"), "buyer", t);
  bindRegister(document.getElementById("seller-form"), "seller", t);
  bindRegister(document.getElementById("admin-form"), "admin", t);
};

function memberCard(kind, t) {
  var title = kind === "buyer" ? t("buyerRegisterTitle") : t("sellerRegisterTitle");
  var hint = kind === "buyer" ? t("buyerRegisterHint") : t("sellerRegisterHint");
  var button = kind === "buyer" ? t("createBuyerAccount") : t("createSellerAccount");
  return '<section class="panel register-card register-card-' + kind + '">' +
    "<h2>" + C2C.esc(title) + "</h2>" +
    '<p class="hint">' + C2C.esc(hint) + "</p>" +
    '<form id="' + kind + '-form" class="form">' +
    '<label class="field">' + C2C.esc(t("displayName")) + '<input name="display_name" maxlength="40" required autocomplete="nickname"></label>' +
    '<label class="field">' + C2C.esc(t("email")) + '<input name="email" type="email" required autocomplete="username"></label>' +
    '<label class="field">' + C2C.esc(t("password")) + '<input name="password" type="password" minlength="6" required autocomplete="new-password"></label>' +
    '<button class="btn" type="submit">' + C2C.esc(button) + "</button>" +
    "</form></section>";
}

function bindLogin() {
  document.getElementById("auth-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var form = event.currentTarget;
    var button = form.querySelector("button");
    var data = new FormData(form);
    button.disabled = true;
    var result = await C2C.state.client.auth.signInWithPassword({
      email: String(data.get("email") || "").trim(),
      password: String(data.get("password") || "")
    });
    if (result.error) {
      button.disabled = false;
      C2C.flash(C2C.errorText(result.error), "bad");
      return;
    }
    var next = C2C.safeNext(new URLSearchParams(location.search).get("next") || "");
    location.href = next || C2C.path("index.html");
  });
}

function bindRegister(form, kind, t) {
  if (!form) return;
  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    var button = form.querySelector('button[type="submit"]');
    var data = new FormData(form);
    var email = String(data.get("email") || "").trim().toLowerCase();
    var password = String(data.get("password") || "");
    var displayName = String(data.get("display_name") || "").trim();
    var meta = {
      display_name: displayName,
      signup_kind: kind,
      want_buyer: kind === "buyer" || kind === "admin",
      want_seller: kind === "seller" || kind === "admin"
    };

    if (kind === "admin") {
      if (email !== ADMIN_EMAIL) {
        C2C.flash(t("adminEmailOnly"), "bad");
        return;
      }
    } else if (email === ADMIN_EMAIL) {
      C2C.flash(t("adminEmailReserved"), "bad");
      return;
    }

    button.disabled = true;
    var result = await C2C.state.client.auth.signUp({
      email: email,
      password: password,
      options: { data: meta }
    });
    if (result.error) {
      button.disabled = false;
      C2C.flash(C2C.errorText(result.error), "bad");
      return;
    }
    if (!result.data.session) {
      button.disabled = false;
      C2C.flash(t("accountCreated"), "ok");
      return;
    }
    var dest = "index.html";
    if (kind === "admin") dest = "admin/transactions.html";
    else if (kind === "seller") dest = "seller/products.html";
    location.href = C2C.path(dest);
  });
}
