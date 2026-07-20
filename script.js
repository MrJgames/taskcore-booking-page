(function () {
  "use strict";

  const PHONE = "+14428225367";
  const dialog = document.getElementById("booking-dialog");
  const quoteForm = document.getElementById("quote-form");
  const photoInput = document.getElementById("photo-input");
  const photoPreviews = document.getElementById("photo-previews");
  const formStatus = document.getElementById("form-status");
  const installButton = document.getElementById("install-button");
  const offlineToast = document.getElementById("offline-toast");
  let deferredInstallPrompt = null;
  let previewUrls = [];

  function recordClick(name) {
    try {
      const key = `taskcore_${name}_clicks`;
      const count = Number.parseInt(localStorage.getItem(key) || "0", 10);
      localStorage.setItem(key, String(count + 1));
    } catch (_) {
      // Contact actions remain available when browser storage is blocked.
    }
  }

  function handleBooking() {
    recordClick("book");
    if (typeof TASKCORE_BOOKING_URL === "string" && TASKCORE_BOOKING_URL.trim()) {
      window.open(TASKCORE_BOOKING_URL.trim(), "_blank", "noopener,noreferrer");
      return;
    }
    if (typeof dialog.showModal === "function") dialog.showModal();
    else alert("Online booking is being connected. Please call or text Jay at (442) 822-5367.");
  }

  document.querySelectorAll(".booking-trigger").forEach((button) => button.addEventListener("click", handleBooking));
  document.querySelectorAll(`a[href^="tel:${PHONE}"]`).forEach((link) => link.addEventListener("click", () => recordClick("call")));
  document.querySelectorAll(`a[href^="sms:${PHONE}"]`).forEach((link) => link.addEventListener("click", () => recordClick("text")));
  dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });

  quoteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!quoteForm.reportValidity()) return;
    const data = new FormData(quoteForm);
    const quote = {
      name: String(data.get("name") || ""), phone: String(data.get("phone") || ""),
      email: String(data.get("email") || ""), address: String(data.get("address") || ""),
      issue: String(data.get("issue") || ""), contactMethod: String(data.get("contactMethod") || ""),
      appointmentDate: String(data.get("appointmentDate") || ""), savedAt: new Date().toISOString()
    };
    try {
      localStorage.setItem("taskcore_quote_request", JSON.stringify(quote));
      formStatus.textContent = "Quote request saved on this device. Jay has not received it yet.";
      quoteForm.reset();
      clearPhotoPreviews();
      formStatus.focus?.();
    } catch (_) {
      formStatus.textContent = "This browser could not save the request. Please call or text Jay instead.";
    }
  });

  function clearPhotoPreviews() {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    previewUrls = [];
    photoPreviews.replaceChildren();
  }

  photoInput.addEventListener("change", () => {
    clearPhotoPreviews();
    const files = Array.from(photoInput.files || []).filter((file) => file.type.startsWith("image/"));
    files.forEach((file) => {
      const url = URL.createObjectURL(file);
      previewUrls.push(url);
      const item = document.createElement("div"); item.className = "photo-preview";
      const image = document.createElement("img"); image.src = url; image.alt = `Preview of ${file.name}`;
      const name = document.createElement("span"); name.textContent = file.name;
      item.append(image, name); photoPreviews.append(item);
    });
    photoPreviews.setAttribute("aria-label", files.length ? `${files.length} photo preview${files.length === 1 ? "" : "s"}` : "No photo previews");
  });
  window.addEventListener("beforeunload", clearPhotoPreviews);

  const revealObserver = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
    entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add("visible"); revealObserver.unobserve(entry.target); } });
  }, { threshold: 0.1 }) : null;
  document.querySelectorAll(".reveal").forEach((element) => revealObserver ? revealObserver.observe(element) : element.classList.add("visible"));

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault(); deferredInstallPrompt = event; installButton.hidden = false;
  });
  installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null; installButton.hidden = true;
  });
  window.addEventListener("appinstalled", () => { installButton.hidden = true; deferredInstallPrompt = null; });

  function updateNetworkStatus() {
    offlineToast.classList.toggle("show", !navigator.onLine);
  }
  window.addEventListener("online", updateNetworkStatus);
  window.addEventListener("offline", updateNetworkStatus);
  updateNetworkStatus();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
  }
  document.getElementById("year").textContent = new Date().getFullYear();
}());
