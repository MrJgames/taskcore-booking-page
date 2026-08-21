(function () {
  "use strict";

  const phone = "+14428225367";
  const email = "service@taskcorepros.com";
  const menuToggle = document.getElementById("menu-toggle");
  const navPanel = document.getElementById("nav-panel");
  const form = document.getElementById("request");
  const formStatus = document.getElementById("form-status");
  const preparedActions = document.getElementById("prepared-actions");
  const sendText = document.getElementById("send-text");
  const sendEmail = document.getElementById("send-email");
  const copyRequest = document.getElementById("copy-request");
  const consentBanner = document.getElementById("analytics-consent-banner");
  const consentAccept = document.getElementById("consent-accept");
  const consentDecline = document.getElementById("consent-decline");
  const consentSettings = document.getElementById("consent-settings");
  const consentStorageKey = "taskcore.analytics-consent.v1";
  let preparedRequest = "";

  function storedConsent() {
    try {
      return localStorage.getItem(consentStorageKey);
    } catch (_) {
      return null;
    }
  }

  function updateAnalyticsConsent(accepted) {
    window.gtag("consent", "update", {
      analytics_storage: accepted ? "granted" : "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied"
    });
    try {
      localStorage.setItem(consentStorageKey, accepted ? "accepted" : "declined");
    } catch (_) {}
    consentBanner.hidden = true;
    consentSettings.focus();
  }

  if (!storedConsent()) consentBanner.hidden = false;
  consentAccept.addEventListener("click", () => updateAnalyticsConsent(true));
  consentDecline.addEventListener("click", () => updateAnalyticsConsent(false));
  consentSettings.addEventListener("click", () => {
    consentBanner.hidden = false;
    consentAccept.focus();
  });

  const publicStats = window.TASKCORE_PUBLIC_STATS || {};
  const propertiesSupported = Number(publicStats.propertiesSupported);
  if (Number.isInteger(propertiesSupported) && propertiesSupported >= 0) {
    document.querySelectorAll("[data-property-count]").forEach((element) => {
      element.textContent = String(propertiesSupported);
    });
  }

  function closeMenu() {
    navPanel.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
  }

  menuToggle.addEventListener("click", () => {
    const open = navPanel.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", String(open));
  });
  navPanel.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); });

  function requestMessage(values) {
    const lines = [
      "Hi Jessie, I found TaskCore and would like help.",
      "",
      `Name: ${values.get("name")}`,
      `Phone: ${values.get("phone")}`,
      `Email: ${values.get("email") || "Not provided"}`,
      `Service: ${values.get("service")}`,
      `Address: ${values.get("address") || "Not provided"}`,
      "",
      "Request details:",
      String(values.get("details") || "").trim()
    ];
    return lines.join("\n");
  }

  form.addEventListener("input", () => {
    preparedActions.hidden = true;
    formStatus.textContent = "";
    formStatus.className = "form-status";
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) {
      formStatus.textContent = "Please complete the required fields.";
      formStatus.className = "form-status error";
      return;
    }
    preparedRequest = requestMessage(new FormData(form));
    sendText.href = `sms:${phone}?body=${encodeURIComponent(preparedRequest)}`;
    sendEmail.href = `mailto:${email}?subject=${encodeURIComponent("TaskCore service request")}&body=${encodeURIComponent(preparedRequest)}`;
    preparedActions.hidden = false;
    formStatus.textContent = "Your request is ready. Choose Text, Email, or Copy Details.";
    formStatus.className = "form-status success";
  });

  copyRequest.addEventListener("click", async () => {
    if (!preparedRequest) return;
    try {
      await navigator.clipboard.writeText(preparedRequest);
    } catch (_) {
      const helper = document.createElement("textarea");
      helper.value = preparedRequest;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.append(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }
    formStatus.textContent = "Request details copied.";
    formStatus.className = "form-status success";
  });

  document.getElementById("year").textContent = new Date().getFullYear();
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
  }
}());
