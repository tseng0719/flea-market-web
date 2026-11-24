window.C2CPage = async function () {
  if (!C2C.state.session) {
    location.href = C2C.path("login.html") + "?next=" + encodeURIComponent(C2C.path("profile.html"));
    return;
  }
  await renderProfile();
};

async function loadProfile() {
  var res = await C2C.state.client
    .from("profiles")
    .select("id, email, display_name, phone, address, created_at")
    .eq("id", C2C.userId())
    .maybeSingle();
  if (res.error) throw res.error;
  return res.data;
}

function roleBadges(t) {
  var chips = (C2C.state.roles || []).map(function (role) {
    var label = role === "seller" ? t("sellerMode") : role === "admin" ? t("adminMode") : t("buyerMode");
    return '<span class="product-chip">' + C2C.esc(label) + "</span>";
  });
  var status = C2C.state.profile && C2C.state.profile.seller_status;
  if (status === "pending" && (C2C.state.roles || []).indexOf("seller") < 0) {
    chips.push('<span class="product-chip">' + C2C.esc(t("sellerPendingBadge")) + "</span>");
  } else if (status === "rejected" && (C2C.state.roles || []).indexOf("seller") < 0) {
    chips.push('<span class="product-chip">' + C2C.esc(t("sellerRejectedBadge")) + "</span>");
  }
  return chips.join(" ") || '<span class="hint">—</span>';
}

async function renderProfile() {
  var app = document.getElementById("app");
  var t = C2C.t;
  var profile = await loadProfile();
  if (!profile) {
    app.innerHTML = '<section class="panel"><h1>' + C2C.esc(t("profileTitle")) + "</h1><p class=\"hint\">" + C2C.esc(t("profileMissing")) + "</p></section>";
    return;
  }
  await C2C.prepare([profile.display_name]);

  app.innerHTML =
    '<div class="page-head"><div><h1>' + C2C.esc(t("profileTitle")) + '</h1><p class="hint">' + C2C.esc(t("profileHint")) + "</p></div></div>" +
    '<section class="panel profile-panel">' +
    '<div class="profile-hero">' +
    '<div class="profile-avatar" aria-hidden="true">' + C2C.esc((profile.display_name || "?").slice(0, 1)) + "</div>" +
    "<div><h2>" + C2C.esc(C2C.shown(profile.display_name || "")) + "</h2>" +
    '<p class="hint">' + C2C.esc(profile.email || "") + "</p>" +
    '<div class="profile-roles">' + roleBadges(t) + "</div>" +
    (C2C.state.profile && C2C.state.profile.seller_status === "pending"
      ? '<p class="hint">' + C2C.esc(t("sellerPendingBody")) + "</p>"
      : "") +
    (C2C.state.profile && C2C.state.profile.seller_status === "rejected"
      ? '<p class="hint">' + C2C.esc(
          C2C.state.profile.seller_reject_reason
            ? t("sellerRejectedReason", { reason: C2C.state.profile.seller_reject_reason })
            : t("sellerRejectedBody")
        ) + "</p>"
      : "") +
    '<p class="hint">' + C2C.esc(t("profileJoined", { time: C2C.when(profile.created_at) || "—" })) + "</p>" +
    "</div></div>" +
    '<form id="profile-form" class="checkout-grid profile-form">' +
    '<label class="field span-2">' + C2C.esc(t("displayName")) +
    '<input name="display_name" maxlength="40" required value="' + C2C.esc(profile.display_name || "") + '">' +
    "</label>" +
    '<label class="field span-2">' + C2C.esc(t("email")) +
    '<input value="' + C2C.esc(profile.email || "") + '" readonly>' +
    "</label>" +
    '<label class="field">' + C2C.esc(t("profilePhone")) +
    '<input name="phone" maxlength="20" inputmode="tel" placeholder="' + C2C.esc(t("profilePhonePh")) + '" value="' + C2C.esc(profile.phone || "") + '">' +
    "</label>" +
    '<label class="field span-2">' + C2C.esc(t("profileAddress")) +
    '<textarea name="address" maxlength="200" placeholder="' + C2C.esc(t("profileAddressPh")) + '">' + C2C.esc(profile.address || "") + "</textarea>" +
    "</label>" +
    '<p class="hint span-2">' + C2C.esc(t("profileContactHint")) + "</p>" +
    '<div class="span-2"><button class="btn" type="submit">' + C2C.esc(t("saveProfile")) + "</button></div>" +
    "</form></section>" +
    '<section class="panel profile-panel">' +
    "<h2>" + C2C.esc(t("changePassword")) + "</h2>" +
    '<p class="hint">' + C2C.esc(t("changePasswordHint")) + "</p>" +
    '<form id="password-form" class="checkout-grid profile-form">' +
    '<label class="field span-2">' + C2C.esc(t("newPassword")) +
    '<input name="password" type="password" minlength="6" maxlength="72" required autocomplete="new-password">' +
    "</label>" +
    '<label class="field span-2">' + C2C.esc(t("confirmPassword")) +
    '<input name="password2" type="password" minlength="6" maxlength="72" required autocomplete="new-password">' +
    "</label>" +
    '<div class="span-2"><button class="btn ghost" type="submit">' + C2C.esc(t("savePassword")) + "</button></div>" +
    "</form></section>";

  document.getElementById("profile-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var form = event.target;
    var name = String(form.elements.display_name.value || "").trim();
    var phone = String(form.elements.phone.value || "").replace(/\s/g, "");
    var address = String(form.elements.address.value || "").trim();
    if (name.length < 1 || name.length > 40) {
      C2C.flash(t("needDisplayName"), "bad");
      return;
    }
    if (phone && !/^[0-9+\-]{8,20}$/.test(phone)) {
      C2C.flash(t("badPhone"), "bad");
      return;
    }
    if (address.length > 200) {
      C2C.flash(t("needAddress"), "bad");
      return;
    }
    var button = form.querySelector("button");
    button.disabled = true;
    var saved = await C2C.state.client
      .from("profiles")
      .update({ display_name: name, phone: phone, address: address })
      .eq("id", C2C.userId());
    button.disabled = false;
    if (saved.error) {
      C2C.flash(C2C.errorText(saved.error), "bad");
      return;
    }
    C2C.state.profile = Object.assign({}, C2C.state.profile || {}, {
      display_name: name,
      phone: phone,
      address: address,
      email: profile.email
    });
    C2C.flash(t("profileSaved"));
    await renderProfile();
    if (window.C2C.renderChrome) window.C2C.renderChrome();
  });

  document.getElementById("password-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var form = event.target;
    var password = String(form.elements.password.value || "");
    var password2 = String(form.elements.password2.value || "");
    if (password.length < 6) {
      C2C.flash(t("passwordShort"), "bad");
      return;
    }
    if (password !== password2) {
      C2C.flash(t("passwordMismatch"), "bad");
      return;
    }
    var button = form.querySelector("button");
    button.disabled = true;
    var saved = await C2C.state.client.auth.updateUser({ password: password });
    button.disabled = false;
    if (saved.error) {
      C2C.flash(C2C.errorText(saved.error), "bad");
      return;
    }
    form.reset();
    C2C.flash(t("passwordSaved"));
  });
}
