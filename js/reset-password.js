window.C2CPage = async function () {
  var app = document.getElementById("app");
  var t = C2C.t;

  if (!C2C.configured()) {
    app.innerHTML = '<section class="panel"><h1>' + C2C.esc(t("resetTitle")) + "</h1><p>" + C2C.esc(t("authNeed")) + "</p></section>";
    return;
  }

  function linkError() {
    var hash = String(location.hash || "").replace(/^#/, "");
    var query = String(location.search || "").replace(/^\?/, "");
    var fromHash = new URLSearchParams(hash);
    var fromQuery = new URLSearchParams(query);
    return fromHash.get("error_description") || fromHash.get("error") ||
      fromQuery.get("error_description") || fromQuery.get("error") || "";
  }

  function showBad(message) {
    app.innerHTML =
      '<section class="panel auth-panel"><h1>' + C2C.esc(t("resetTitle")) + "</h1>" +
      "<p>" + C2C.esc(message) + "</p>" +
      '<p class="hint auth-switch"><a href="' + C2C.esc(C2C.path("forgot-password.html")) + '">' + C2C.esc(t("forgotAgain")) + "</a></p></section>";
  }

  var errText = linkError();
  if (errText) {
    showBad(C2C.errorText({ message: errText }));
    return;
  }

  async function ensureRecoverySession() {
    if (C2C.state.session) return C2C.state.session;
    var refreshed = await C2C.state.client.auth.getSession();
    if (refreshed.error) throw refreshed.error;
    if (refreshed.data.session) {
      C2C.state.session = refreshed.data.session;
      return C2C.state.session;
    }
    return await new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        sub.subscription.unsubscribe();
        resolve(null);
      }, 2500);
      var sub = C2C.state.client.auth.onAuthStateChange(function (event, session) {
        if (done) return;
        if (session && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
          done = true;
          clearTimeout(timer);
          sub.subscription.unsubscribe();
          C2C.state.session = session;
          resolve(session);
        }
      });
    });
  }

  var session;
  try {
    session = await ensureRecoverySession();
  } catch (err) {
    showBad(C2C.errorText(err));
    return;
  }

  if (!session) {
    showBad(t("resetLinkBad"));
    return;
  }

  if (C2C.state.profile && C2C.state.profile.deleted_at) {
    await C2C.state.client.auth.signOut();
    C2C.state.session = null;
    app.innerHTML =
      '<section class="panel auth-panel"><h1>' + C2C.esc(t("resetTitle")) + "</h1>" +
      "<p>" + C2C.esc(t("accountDeletedLogin")) + "</p>" +
      '<p class="hint auth-switch"><a href="' + C2C.esc(C2C.path("login.html")) + '">' + C2C.esc(t("backToLogin")) + "</a></p></section>";
    return;
  }

  app.innerHTML =
    '<section class="panel auth-panel">' +
    "<h1>" + C2C.esc(t("resetTitle")) + "</h1>" +
    '<p class="hint">' + C2C.esc(t("resetHint")) + "</p>" +
    '<form id="reset-form" class="form">' +
    '<label class="field">' + C2C.esc(t("newPassword")) +
    '<input name="password" type="password" minlength="6" maxlength="72" required autocomplete="new-password"></label>' +
    '<label class="field">' + C2C.esc(t("confirmPassword")) +
    '<input name="password2" type="password" minlength="6" maxlength="72" required autocomplete="new-password"></label>' +
    '<button class="btn" type="submit">' + C2C.esc(t("resetSave")) + "</button>" +
    "</form></section>";

  document.getElementById("reset-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var form = event.currentTarget;
    var button = form.querySelector('button[type="submit"]');
    var data = new FormData(form);
    var password = String(data.get("password") || "");
    var password2 = String(data.get("password2") || "");
    if (password.length < 6) {
      C2C.flash(t("passwordShort"), "bad");
      return;
    }
    if (password !== password2) {
      C2C.flash(t("passwordMismatch"), "bad");
      return;
    }
    button.disabled = true;
    var saved = await C2C.state.client.auth.updateUser({ password: password });
    if (saved.error) {
      button.disabled = false;
      C2C.flash(C2C.errorText(saved.error), "bad");
      return;
    }
    C2C.flash(t("resetSaved"));
    await C2C.state.client.auth.signOut();
    location.href = C2C.path("login.html");
  });
};
