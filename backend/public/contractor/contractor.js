const $ = (s) => document.querySelector(s),
  esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
async function api(url, o = {}) {
  const r = await fetch(url, o),
    j = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(j.error || "Request failed");
  return j;
}
async function load() {
  const d = await api("../api/contractor/offers");
  $("#login").hidden = true;
  $("#offers").hidden = false;
  $("#offers").innerHTML =
    "<h2>Your work</h2>" +
      d.offers
        .map(
          (o) =>
            `<article class="panel" data-offer="${o.id}"><span class="badge">${esc(o.status)}</span><h3>${esc(o.request_number)} · ${esc(o.property_name)}</h3><p>${esc(o.address)}</p><p>${esc(o.scope)}</p><p><b>Offer:</b> $${(o.offered_compensation_cents / 100).toFixed(2)} · ${esc(o.service_window)}</p>${o.status === "Offered" ? '<button data-decision="Accepted">Accept</button> <button data-decision="Declined">Decline</button>' : ""}${o.status === "Accepted" ? `<form data-completion="${o.request_id}"><h4>Submit completion for TaskCore review</h4><label>Completion notes<textarea name="completionNotes" required></textarea></label><label>Materials notes<textarea name="materialsNotes"></textarea></label><label>Invoice amount ($)<input name="invoiceAmount" type="number" min="0" step=".01"></label><button>Send completion to TaskCore</button><output></output></form>` : ""}</article>`,
        )
        .join("") || "<p>No offers.</p>";
  document.querySelectorAll("[data-decision]").forEach(
    (b) =>
      (b.onclick = async () => {
        await api(
          `../api/contractor/offers/${b.closest("[data-offer]").dataset.offer}/respond`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision: b.dataset.decision }),
          },
        );
        await load();
      }),
  );
  document.querySelectorAll("[data-completion]").forEach(
    (form) =>
      (form.onsubmit = async (event) => {
        event.preventDefault();
        const payload = Object.fromEntries(new FormData(form));
        payload.invoiceAmount = payload.invoiceAmount
          ? Number(payload.invoiceAmount)
          : null;
        try {
          await api(`../api/contractor/requests/${form.dataset.completion}/completion`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          await load();
        } catch (error) {
          form.querySelector("output").textContent = error.message;
        }
      }),
  );
}
$("#login-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api("../api/contractor/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
    });
    await load();
  } catch (x) {
    $("output", e.currentTarget).textContent = x.message;
  }
};
api("../api/contractor/session")
  .then(load)
  .catch(() => {});
