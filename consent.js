(function () {
  "use strict";

  const consentBanner = document.getElementById("analytics-consent-banner");
  const consentAccept = document.getElementById("consent-accept");
  const consentDecline = document.getElementById("consent-decline");
  const consentSettings = document.getElementById("consent-settings");
  const consentStorageKey = "taskcore.analytics-consent.v1";

  if (!consentBanner || !consentAccept || !consentDecline || !consentSettings) return;

  function storedConsent() {
    try {
      return localStorage.getItem(consentStorageKey);
    } catch (_) {
      return null;
    }
  }

  function updateAnalyticsConsent(accepted) {
    if (typeof window.gtag === "function") {
      window.gtag("consent", "update", {
        analytics_storage: accepted ? "granted" : "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied"
      });
      if (accepted) {
        window.gtag("event", "page_view", {
          page_title: document.title,
          page_location: window.location.href,
          page_path: window.location.pathname + window.location.search
        });
      }
    }
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
}());
