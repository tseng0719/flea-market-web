window.C2CPage = async function () {
  var app = document.getElementById("app");
  var t = C2C.t;

  if (C2C.state.session) {
    location.href = C2C.path("profile.html");
    return;
  }
  if (!C2C.configured()) {
    app.innerHTML = '<section class="panel"><h1>' + C2C.esc(t("forgotTitle")) + "</h1><p>" + C2C.esc(t("authNeed")) + "</p></section>";
    return;
  }

  app.innerHTML =
    '<section class="panel auth-panel">' +
    "<h1>" + C2C.esc(t("forgotTitle")) + "</h1>" +
    '<p class="hint">' + C2C.esc(t("forgotHint")) + "</p>" +
    '<form id="forgot-form" class="form">' +
    '<label class="field">' + C2C.esc(t("email")) +
    '<input name="email" type="email" required autocomplete="username"></label>' +
    '<button class="btn" type="submit">' + C2C.esc(t("forgotSend")) + "</button>" +
    "</form>" +
    '<p class="hint auth-switch"><a href="' + C2C.esc(C2C.path("login.html")) + '">' + C2C.esc(t("backToLogin")) + "</a></p>" +
    "</section>";

  document.getElementById("forgot-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var form = event.currentTarget;
    var button = form.querySelector('button[type="submit"]');
    var email = String(new FormData(form).get("email") || "").trim().toLowerCase();
    if (!email) {
      C2C.flash(t("needEmail"), "bad");
      return;
    }
    button.disabled = true;
    var redirectTo = C2C.absoluteUrl("reset-password.html");
    // Vercel cleanUrls: prefer extensionless so the recovery link does not 308-redirect.
    if (!/^(localhost|127\.0\.0\.1)$/i.test(location.hostname)) {
      redirectTo = redirectTo.replace(/\.html(?=([?#]|$))/i, "");
    }
    var result = await C2C.state.client.auth.resetPasswordForEmail(email, { redirectTo: redirectTo });
    button.disabled = false;
    if (result.error) {
      C2C.flash(C2C.errorText(result.error), "bad");
      return;
    }
    C2C.flash(t("forgotSent"));
    form.reset();
  });
};
