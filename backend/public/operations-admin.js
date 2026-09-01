(() => {
  const esc = (v) =>
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
      ),
    root = document.querySelector("#dispatch-list");
  async function api(url, o = {}) {
    const r = await fetch(url, o),
      j = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(j.error || "Request failed");
    return j;
  }
  async function load() {
    const d = await api("../api/admin/operations/requests");
    root.innerHTML =
      d.requests
        .map(
          (r) =>
            `<article class="inspection-card"><span class="status-badge">${esc(r.status)}</span><h3>${esc(r.request_number)} · ${esc(r.title)}</h3><p>${esc(r.organization_name)} · ${esc(r.property_name)}<br>${esc(r.address)}</p><p>${esc(r.priority)} · ${esc(r.category)}</p><details><summary>Dispatch controls</summary><form data-request="${r.id}"><label>Status<select name="status">${["owner_review", "needs_information", "estimating", "awaiting_approval", "approved", "dispatching", "assigned", "scheduled", "in_progress", "awaiting_completion_review", "completed", "declined", "closed"].map((s) => `<option ${s === r.status ? "selected" : ""}>${s}</option>`).join("")}</select></label><label>Internal notes<textarea name="internalNotes">${esc(r.internal_notes)}</textarea></label><button>Save dispatch</button><output></output></form></details></article>`,
        )
        .join("") || "<p>No managed requests.</p>";
    root.querySelectorAll("form").forEach(
      (f) =>
        (f.onsubmit = async (e) => {
          e.preventDefault();
          try {
            await api(
              `../api/admin/operations/requests/${f.dataset.request}/dispatch`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(Object.fromEntries(new FormData(f))),
              },
            );
            await load();
          } catch (x) {
            f.querySelector("output").textContent = x.message;
          }
        }),
    );
  }
  async function loadSetup() {
    const setup = await api("../api/admin/operations/setup");
    document.querySelector("#operations-setup-summary").textContent =
      `${setup.organizations.length} organizations · ${setup.users.length} organization users · ${setup.vendors.length} contractors · ${setup.channels.length} work channels`;
  }
  function wireCreateForm(selector, endpoint, normalize = (value) => value) {
    const form = document.querySelector(selector);
    form.onsubmit = async (event) => {
      event.preventDefault();
      try {
        await api(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(normalize(Object.fromEntries(new FormData(form)))),
        });
        form.reset();
        form.querySelector("output").textContent = "Created.";
        await loadSetup();
      } catch (error) {
        form.querySelector("output").textContent = error.message;
      }
    };
  }
  document.querySelector("#refresh-dispatch").onclick = load;
  wireCreateForm("#organization-form", "../api/admin/operations/organizations");
  wireCreateForm("#vendor-form", "../api/admin/operations/vendors", (value) => ({ ...value, channelIds: [] }));
  load().catch((e) => (root.textContent = e.message));
  loadSetup().catch((e) => (document.querySelector("#operations-setup-summary").textContent = e.message));
})();
