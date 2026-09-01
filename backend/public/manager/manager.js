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
let data;
async function api(url, o = {}) {
  const r = await fetch(url, o),
    j = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(j.error || "Request failed");
  return j;
}
async function load() {
  data = await api("../api/manager/dashboard");
  $("#login").hidden = true;
  $("#app").hidden = false;
  $("#nav").hidden = false;
  $("#summary").innerHTML = Object.entries(data.counts)
    .map(
      ([k, v]) =>
        `<div class="card"><span class="metric">${v}</span><small>${esc(k.replace(/([A-Z])/g, " $1"))}</small></div>`,
    )
    .join("");
  show("dashboard");
}
async function show(view) {
  const c = $("#content");
  if (view === "approvals") {
    const pending = data.requests.filter((request) => request.status === "awaiting_approval");
    const details = await Promise.all(pending.map((request) => api(`../api/manager/requests/${request.id}`)));
    c.innerHTML = "<h2>Estimate approvals</h2>" + (details.map(({ request, estimate }) => `<article class="panel"><span class="badge">${esc(estimate.status)}</span><h3>${esc(request.request_number)} · ${esc(request.title)}</h3><p>${esc(estimate.scope)}</p><p><strong>$${(estimate.amount_cents / 100).toFixed(2)}</strong></p><form data-estimate="${estimate.id}"><label>Comment<textarea name="comment"></textarea></label><button name="decision" value="Approved">Approve</button> <button name="decision" value="Declined">Decline</button> <button name="decision" value="Changes Requested">Request changes</button><output></output></form></article>`).join("") || "<p>No estimates awaiting approval.</p>");
    c.querySelectorAll("[data-estimate]").forEach((form) => form.onsubmit = async (event) => { event.preventDefault(); const decision = event.submitter.value; try { await api(`../api/manager/estimates/${form.dataset.estimate}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, comment: new FormData(form).get("comment") || "" }) }); await load(); } catch (error) { form.querySelector("output").textContent = error.message; } });
  } else if (view === "properties")
    c.innerHTML =
      "<h2>Properties</h2>" +
      data.properties
        .map(
          (p) =>
            `<article class="panel"><h3>${esc(p.name)}</h3><p>${esc(p.address)}</p><button data-history="${p.id}">View history</button></article>`,
        )
        .join("");
  else
    c.innerHTML =
      "<h2>Service Requests</h2>" +
        data.requests
          .map(
            (r) =>
              `<article class="panel request"><span class="badge">${esc(r.status)}</span><h3>${esc(r.request_number)} · ${esc(r.title)}</h3><p>${esc(r.description)}</p></article>`,
          )
          .join("") || "<p>No requests yet.</p>";
  document.querySelectorAll("[data-history]").forEach(
    (b) =>
      (b.onclick = async () => {
        const h = await api(
          `../api/manager/properties/${b.dataset.history}/history`,
        );
        c.innerHTML =
          `<h2>${esc(h.property.name)}</h2>` +
          h.activity
            .map(
              (a) =>
                `<article class="panel"><b>${esc(a.event_type)}</b><p>${esc(a.summary)}</p></article>`,
            )
            .join("");
      }),
  );
}
$("#login-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api("../api/manager/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
    });
    await load();
  } catch (x) {
    $("output", e.currentTarget).textContent = x.message;
  }
};
document
  .querySelectorAll("[data-view]")
  .forEach((b) => (b.onclick = () => show(b.dataset.view)));
$("#new-request").onclick = () => {
  $("#content").hidden = true;
  $("#request-form").hidden = false;
  $("#request-form select[name=propertyId]").innerHTML = data.properties
    .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
    .join("");
};
$("#cancel-request").onclick = () => {
  $("#request-form").hidden = true;
  $("#content").hidden = false;
};
$("#request-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.currentTarget));
  f.permissionToEnter = e.currentTarget.permissionToEnter.checked;
  f.spendingLimit = f.spendingLimit ? Number(f.spendingLimit) : null;
  f.preferredServiceDate = f.preferredServiceDate || null;
  try {
    await api("../api/manager/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(f),
    });
    e.currentTarget.reset();
    e.currentTarget.hidden = true;
    $("#content").hidden = false;
    await load();
  } catch (x) {
    $("output", e.currentTarget).textContent = x.message;
  }
};
api("../api/manager/session")
  .then(load)
  .catch(() => {});
