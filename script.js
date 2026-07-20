(function () {
  "use strict";
  const dialog = document.getElementById("booking-dialog");
  const bookingButtons = [document.getElementById("book-button"), document.getElementById("book-button-bottom")];

  function recordClick(name) {
    try {
      const key = `taskcore_${name}_clicks`;
      const current = Number.parseInt(localStorage.getItem(key) || "0", 10);
      localStorage.setItem(key, String(current + 1));
    } catch (_) {
      // The action still works when browser storage is unavailable.
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

  bookingButtons.forEach((button) => button.addEventListener("click", handleBooking));
  document.querySelectorAll('a[href^="tel:+14428225367"]').forEach((link) =>
    link.addEventListener("click", () => recordClick("call"))
  );
  document.querySelectorAll('a[href^="sms:+14428225367"]').forEach((link) =>
    link.addEventListener("click", () => recordClick("text"))
  );
  dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  document.getElementById("year").textContent = new Date().getFullYear();
}());
