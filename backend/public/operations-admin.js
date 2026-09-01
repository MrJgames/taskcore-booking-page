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
    const filters = new URLSearchParams(
      new FormData(document.querySelector("#dispatch-filters")),
    );
    [...filters].forEach(([key, value]) => {
      if (!value) filters.delete(key);
    });
    const d = await api(`../api/admin/operations/requests?${filters}`);
    document.querySelector("#dispatch-summary").innerHTML = Object.entries(
      d.summary || {},
    )
      .map(
        ([key, value]) =>
          `<span class="status-badge">${esc(key.replace(/([A-Z])/g, " $1"))}: ${value}</span>`,
      )
      .join(" ");
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
    document.querySelector("#channel-list").innerHTML = setup.channels
      .map((channel) => {
        const assignedTechs = setup.technicianChannels.filter((item) => item.channel_id === channel.id).map((item) => item.technician_id), assignedVendors = setup.vendorChannels.filter((item) => item.channel_id === channel.id).map((item) => item.vendor_id);
        return `<form class="inspection-card channel-form" data-id="${channel.id}"><h3>${esc(channel.name)}</h3><label>Display name<input name="name" value="${esc(channel.name)}" required></label><label>Description<textarea name="description">${esc(channel.description)}</textarea></label><label>Sort order<input name="sortOrder" type="number" value="${channel.sort_order}"></label><label><input name="active" type="checkbox" ${channel.active ? "checked" : ""}> Enabled</label><fieldset><legend>Assigned technicians</legend>${setup.technicians.map((tech) => `<label><input type="checkbox" name="technicianIds" value="${tech.id}" ${assignedTechs.includes(tech.id) ? "checked" : ""}> ${esc(tech.name)}</label>`).join("")}</fieldset><fieldset><legend>Assigned vendors</legend>${setup.vendors.map((vendor) => `<label><input type="checkbox" name="vendorIds" value="${vendor.id}" ${assignedVendors.includes(vendor.id) ? "checked" : ""}> ${esc(vendor.business_name)}</label>`).join("")}</fieldset><button>Save channel and assignments</button><output></output></form>`;
      })
      .join("");
    document.querySelectorAll(".channel-form").forEach(
      (form) =>
        (form.onsubmit = async (event) => {
          event.preventDefault();
          const value = Object.fromEntries(new FormData(form));
          value.sortOrder = Number(value.sortOrder);
          value.active = form.elements.active.checked;
          value.complianceReviewRecommended = false;
          try {
            const options = { method: "POST", headers: { "Content-Type": "application/json" } };
            await Promise.all([
              api(`../api/admin/operations/channels/${form.dataset.id}`, { ...options, method: "PATCH", body: JSON.stringify(value) }),
              api(`../api/admin/operations/channels/${form.dataset.id}/technicians`, { ...options, body: JSON.stringify({ technicianIds: [...form.querySelectorAll('[name=technicianIds]:checked')].map((input) => input.value) }) }),
              api(`../api/admin/operations/channels/${form.dataset.id}/vendors`, { ...options, body: JSON.stringify({ vendorIds: [...form.querySelectorAll('[name=vendorIds]:checked')].map((input) => input.value) }) }),
            ]);
            form.querySelector("output").textContent = "Saved.";
          } catch (error) {
            form.querySelector("output").textContent = error.message;
          }
        }),
    );
    document.querySelector("#vendor-list").innerHTML =
      setup.vendors
        .map((vendor) => {
          const warnings = [
            vendor.w9_status !== "Verified" && "W-9 review",
            vendor.insurance_status !== "Verified" && "Insurance review",
            vendor.license_status !== "Verified" && "License review",
          ].filter(Boolean);
          return `<article class="inspection-card"><span class="status-badge">${vendor.active ? "Active" : "Inactive"}</span><h3>${esc(vendor.business_name)}</h3><p>${esc(vendor.contact_name)} · ${esc(vendor.email)} · ${esc(vendor.phone)}</p><p>${warnings.length ? `⚠ ${esc(warnings.join(" · "))}` : "Compliance records verified"}</p><p>Open jobs: ${vendor.open_jobs || 0} · Completed: ${vendor.completed_jobs || 0}</p></article>`;
        })
        .join("") || "<p>No vendors.</p>";
  }
  async function loadCompletions() {
    const data = await api("../api/admin/operations/completions"),
      target = document.querySelector("#completion-list");
    target.innerHTML =
      data.completions
        .map(
          (item) =>
            `<article class="inspection-card"><span class="status-badge">${esc(item.status)}</span><h3>${esc(item.request_number)} · ${esc(item.title)}</h3><p>${esc(item.property_name)} · ${esc(item.address)}</p><p><strong>Performed by:</strong> ${esc(item.technician_name || item.vendor_name)}<br><strong>Completion:</strong> ${esc(item.completion_notes)}<br><strong>Materials:</strong> ${esc(item.materials_notes)}${item.time_spent_minutes != null ? `<br><strong>Time:</strong> ${item.time_spent_minutes} minutes` : ""}${item.invoice_amount_cents != null ? `<br><strong>Contractor invoice:</strong> $${(item.invoice_amount_cents / 100).toFixed(2)}` : ""}</p><form class="completion-review" data-id="${item.id}"><label>Owner/customer note<textarea name="customerNote">${esc(item.customer_completion_notes)}</textarea></label>${item.media.map((media) => `<label><input type="checkbox" name="publishMediaIds" value="${media.id}" ${media.visibility === "Customer" ? "checked" : ""}> Publish ${esc(media.purpose || media.file_name)}</label>`).join("")}<div class="row">${item.status === "Submitted" ? '<button name="action" value="Approved">Approve</button><button name="action" value="Changes Requested">Request correction</button>' : ""}${item.status === "Approved" ? '<button name="action" value="Publish">Publish to customer</button>' : ""}</div><output></output></form></article>`,
        )
        .join("") || "<p>No completions awaiting action.</p>";
    target.querySelectorAll(".completion-review").forEach(
      (form) =>
        (form.onsubmit = async (event) => {
          event.preventDefault();
          const submitter = event.submitter,
            action = submitter.value,
            body = { customerNote: form.elements.customerNote.value };
          if (action === "Publish")
            body.publishMediaIds = [
              ...form.querySelectorAll("[name=publishMediaIds]:checked"),
            ].map((input) => input.value);
          else body.decision = action;
          try {
            await api(
              `../api/admin/operations/completions/${form.dataset.id}/${action === "Publish" ? "publish" : "review"}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              },
            );
            await Promise.all([loadCompletions(), load()]);
          } catch (error) {
            form.querySelector("output").textContent = error.message;
          }
        }),
    );
  }
  function wireCreateForm(selector, endpoint, normalize = (value) => value) {
    const form = document.querySelector(selector);
    form.onsubmit = async (event) => {
      event.preventDefault();
      try {
        await api(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            normalize(Object.fromEntries(new FormData(form))),
          ),
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
  document.querySelector("#dispatch-filters").onsubmit = (event) => {
    event.preventDefault();
    load();
  };
  document.querySelector("#refresh-completions").onclick = loadCompletions;
  wireCreateForm("#organization-form", "../api/admin/operations/organizations");
  wireCreateForm(
    "#vendor-form",
    "../api/admin/operations/vendors",
    (value) => ({ ...value, channelIds: [] }),
  );
  load().catch((e) => (root.textContent = e.message));
  loadSetup().catch(
    (e) =>
      (document.querySelector("#operations-setup-summary").textContent =
        e.message),
  );
  loadCompletions().catch(
    (error) =>
      (document.querySelector("#completion-list").textContent = error.message),
  );
})();
