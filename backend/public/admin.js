(function () {
  "use strict";
  const list = document.getElementById("request-list");
  const pageStatus = document.getElementById("page-status");
  const template = document.getElementById("request-template");

  function formatDate(value, dateOnly) {
    if (!value) return "—";
    const date = new Date(dateOnly ? `${value}T12:00:00` : value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", dateOnly ? { dateStyle: "long" } : { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function setText(card, selector, value) {
    card.querySelector(selector).textContent = value || "—";
  }

  function createCard(request) {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.id = request.id;
    setText(card, ".status-badge", request.status);
    setText(card, ".customer-name", request.customerName);
    setText(card, ".submitted-date", `Submitted ${formatDate(request.createdAt, false)}`);
    setText(card, ".phone", request.phone);
    setText(card, ".contact-method", request.preferredContactMethod);
    setText(card, ".address", request.serviceAddress);
    setText(card, ".preferred-date", formatDate(request.preferredServiceDate, true));
    setText(card, ".arrival-window", request.requestedArrivalWindow);
    setText(card, ".issue", request.issueDescription);
    card.querySelector(".call-link").href = `tel:${request.phone}`;
    card.querySelector(".text-link").href = `sms:${request.phone}`;
    const form = card.querySelector(".admin-form");
    form.elements.status.value = request.status;
    form.elements.privateNote.value = request.privateNote || "";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const saveStatus = card.querySelector(".save-status");
      saveStatus.textContent = "Saving…";
      try {
        const response = await fetch(`../api/admin/service-requests/${encodeURIComponent(request.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: form.elements.status.value, privateNote: form.elements.privateNote.value })
        });
        if (!response.ok) throw new Error("Save failed");
        const result = await response.json();
        setText(card, ".status-badge", result.request.status);
        saveStatus.textContent = "Saved.";
      } catch (_) {
        saveStatus.textContent = "Could not save. Please try again.";
      }
    });
    return card;
  }

  async function loadRequests() {
    pageStatus.textContent = "Loading requests…";
    try {
      const response = await fetch("../api/admin/service-requests", { headers: { "Accept": "application/json" } });
      if (!response.ok) throw new Error("Load failed");
      const data = await response.json();
      list.replaceChildren(...data.requests.map(createCard));
      pageStatus.textContent = data.requests.length ? `${data.requests.length} service request${data.requests.length === 1 ? "" : "s"}. New requests appear first.` : "No service requests yet.";
    } catch (_) {
      pageStatus.textContent = "Requests could not be loaded. Refresh and try again.";
    }
  }

  document.getElementById("refresh").addEventListener("click", loadRequests);
  loadRequests();
}());
