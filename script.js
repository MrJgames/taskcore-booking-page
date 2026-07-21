(function () {
  "use strict";

  const PHONE = "+14428225357";
  const quoteForm = document.getElementById("quote-form");
  const photoInput = document.getElementById("photo-input");
  const photoPreviews = document.getElementById("photo-previews");
  const formStatus = document.getElementById("form-status");
  const requestActions = document.getElementById("request-actions");
  const textRequest = document.getElementById("text-request");
  const copyRequest = document.getElementById("copy-request");
  const installButton = document.getElementById("install-button");
  const mobileContactBar = document.querySelector(".mobile-contact-bar");
  const dateField = quoteForm.elements.appointmentDate;
  const submitButton = quoteForm.querySelector('button[type="submit"]');
  const apiUrl = typeof TASKCORE_API_URL === "string" ? TASKCORE_API_URL.trim().replace(/\/$/, "") : "";
  let deferredInstallPrompt = null;
  let previewUrls = [];
  let preparedRequest = "";

  function recordClick(name) {
    try {
      const key = `taskcore_${name}_clicks`;
      const count = Number.parseInt(localStorage.getItem(key) || "0", 10);
      localStorage.setItem(key, String(count + 1));
    } catch (_) {
      // Contact actions remain available when browser storage is blocked.
    }
  }

  function hidePreparedRequest() {
    preparedRequest = "";
    requestActions.hidden = true;
    formStatus.textContent = "";
    formStatus.className = "form-status";
  }

  function handleBooking() {
    recordClick("book");
    if (typeof TASKCORE_BOOKING_URL === "string" && TASKCORE_BOOKING_URL.trim()) {
      window.open(TASKCORE_BOOKING_URL.trim(), "_blank", "noopener,noreferrer");
      return;
    }
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    quoteForm.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    window.setTimeout(() => quoteForm.elements.name.focus({ preventScroll: true }), reducedMotion ? 0 : 450);
  }

  function formatRequest(data) {
    const email = String(data.get("email") || "").trim();
    const photoCount = Array.from(photoInput.files || []).filter((file) => file.type.startsWith("image/")).length;
    return [
      "TaskCore Appointment Request",
      "",
      `Name: ${String(data.get("name") || "").trim()}`,
      `Phone: ${String(data.get("phone") || "").trim()}`,
      ...(email ? [`Email: ${email}`] : []),
      `Address: ${String(data.get("address") || "").trim()}`,
      `Issue: ${String(data.get("issue") || "").trim()}`,
      `Preferred date: ${String(data.get("appointmentDate") || "").trim()}`,
      `Requested arrival window: ${String(data.get("arrivalWindow") || "").trim()}`,
      `Preferred contact: ${String(data.get("contactMethod") || "").trim()}`,
      `Photos selected: ${photoCount}${photoCount ? " (I will attach them manually.)" : ""}`
    ].join("\n");
  }

  document.querySelectorAll(".booking-trigger").forEach((button) => button.addEventListener("click", handleBooking));
  document.querySelectorAll(`a[href^="tel:${PHONE}"]`).forEach((link) => link.addEventListener("click", () => recordClick("call")));
  document.querySelectorAll(`a[href^="sms:${PHONE}"]`).forEach((link) => link.addEventListener("click", () => recordClick("text")));

  quoteForm.addEventListener("input", hidePreparedRequest);
  function showTextFallback(message) {
    requestActions.hidden = false;
    formStatus.className = "form-status error";
    formStatus.textContent = message;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestActions.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" });
  }

  quoteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!quoteForm.reportValidity()) return;
    const formData = new FormData(quoteForm);
    preparedRequest = formatRequest(formData);
    textRequest.href = `sms:${PHONE}?body=${encodeURIComponent(preparedRequest)}`;
    requestActions.hidden = true;

    if (!apiUrl) {
      showTextFallback("Online submission is not configured yet. Use Text Request so Jay receives your information.");
      return;
    }

    submitButton.disabled = true;
    submitButton.setAttribute("aria-busy", "true");
    formStatus.className = "form-status";
    formStatus.textContent = "Sending your request…";
    const payload = {
      name: String(formData.get("name") || "").trim(),
      phone: String(formData.get("phone") || "").trim(),
      email: String(formData.get("email") || "").trim() || undefined,
      address: String(formData.get("address") || "").trim(),
      issue: String(formData.get("issue") || "").trim(),
      contactMethod: String(formData.get("contactMethod") || "").trim(),
      appointmentDate: String(formData.get("appointmentDate") || "").trim(),
      arrivalWindow: String(formData.get("arrivalWindow") || "").trim(),
      submissionTimestamp: new Date().toISOString()
    };

    try {
      const response = await fetch(`${apiUrl}/api/service-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        if (response.status === 400) {
          formStatus.className = "form-status error";
          formStatus.textContent = "Please check your request details and try again.";
          return;
        }
        throw new Error(`Request failed with status ${response.status}`);
      }
      formStatus.className = "form-status success";
      formStatus.textContent = "Your request has been sent to TaskCore. Jay will contact you to confirm availability.";
      preparedRequest = "";
    } catch (_) {
      showTextFallback("The online request service could not be reached. Use Text Request so Jay still receives your information.");
    } finally {
      submitButton.disabled = false;
      submitButton.removeAttribute("aria-busy");
    }
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
    formStatus.textContent = "Copied successfully.";
  });

  function clearPhotoPreviews() {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    previewUrls = [];
    photoPreviews.replaceChildren();
  }

  photoInput.addEventListener("change", () => {
    hidePreparedRequest();
    clearPhotoPreviews();
    const files = Array.from(photoInput.files || []).filter((file) => file.type.startsWith("image/"));
    files.forEach((file) => {
      const url = URL.createObjectURL(file);
      previewUrls.push(url);
      const item = document.createElement("div");
      item.className = "photo-preview";
      const image = document.createElement("img");
      image.src = url;
      image.alt = `Preview of ${file.name}`;
      const name = document.createElement("span");
      name.textContent = file.name;
      item.append(image, name);
      photoPreviews.append(item);
    });
    photoPreviews.setAttribute("aria-label", files.length ? `${files.length} photo preview${files.length === 1 ? "" : "s"}` : "No photo previews");
  });
  window.addEventListener("beforeunload", clearPhotoPreviews);

  const today = new Date();
  const localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  dateField.min = localToday;

  const revealObserver = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 }) : null;
  document.querySelectorAll(".reveal").forEach((element) => revealObserver ? revealObserver.observe(element) : element.classList.add("visible"));

  if ("IntersectionObserver" in window) {
    mobileContactBar.setAttribute("aria-hidden", "true");
    const heroObserver = new IntersectionObserver(([entry]) => {
      const showQuickContact = !entry.isIntersecting;
      mobileContactBar.classList.toggle("visible", showQuickContact);
      mobileContactBar.setAttribute("aria-hidden", String(!showQuickContact));
    }, { threshold: 0.1 });
    heroObserver.observe(document.querySelector(".hero"));
  } else {
    mobileContactBar.classList.add("visible");
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installButton.hidden = false;
  });
  installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installButton.hidden = true;
  });
  window.addEventListener("appinstalled", () => {
    installButton.hidden = true;
    deferredInstallPrompt = null;
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
  }
  document.getElementById("year").textContent = new Date().getFullYear();
}());
