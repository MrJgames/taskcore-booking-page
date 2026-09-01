(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s),
    $$ = (s, r = document) => [...r.querySelectorAll(s)],
    views = {
      login: $("#login-view"),
      home: $("#home-view"),
      editor: $("#editor-view"),
      job: $("#job-view"),
    };
  let current = null,
    currentJob = null,
    clients = [];
  const templates = {
    Arrival: [
      [
        "Guest readiness",
        [
          [
            "arrival-final-presentation",
            "Property presentation is guest-ready",
          ],
          [
            "arrival-welcome",
            "Welcome materials and arrival instructions are in place",
          ],
        ],
      ],
      [
        "Access",
        [
          ["arrival-access", "Entry codes, keys, remotes, and gates work"],
          ["arrival-locks", "Exterior doors and windows lock correctly"],
        ],
      ],
      [
        "Cleanliness",
        [
          [
            "arrival-cleanliness",
            "Interior is professionally clean with no odors",
          ],
          ["arrival-linens", "Linens and towels are clean and staged"],
        ],
      ],
      [
        "Utilities",
        [
          [
            "arrival-utilities",
            "Power, water, hot water, and gas are available",
          ],
          ["arrival-leaks", "No visible plumbing leaks or moisture"],
        ],
      ],
      [
        "HVAC",
        [
          [
            "arrival-hvac",
            "HVAC operates and thermostat is at the arrival setting",
          ],
        ],
      ],
      [
        "Kitchen",
        [
          [
            "arrival-kitchen",
            "Kitchen surfaces, appliances, and cookware are ready",
          ],
        ],
      ],
      [
        "Bathrooms",
        [
          [
            "arrival-bathrooms",
            "Bathrooms, fixtures, drains, and toiletries are ready",
          ],
        ],
      ],
      [
        "Bedrooms",
        [
          [
            "arrival-bedrooms",
            "Bedrooms, beds, lighting, and storage are ready",
          ],
        ],
      ],
      [
        "Technology",
        [
          [
            "arrival-technology",
            "Wi-Fi, televisions, and smart-home controls work",
          ],
        ],
      ],
      [
        "Amenities",
        [
          [
            "arrival-amenities",
            "Pool, spa, grill, exterior, and listed amenities are ready",
          ],
        ],
      ],
      [
        "Safety equipment",
        [
          [
            "arrival-safety",
            "Smoke/CO devices, extinguishers, and safety equipment appear ready",
          ],
        ],
      ],
      [
        "Supplies",
        [
          [
            "arrival-supplies",
            "Required consumables and guest supplies are stocked",
          ],
        ],
      ],
      [
        "Visible damage",
        [["arrival-damage", "No new visible damage or condition concerns"]],
      ],
      [
        "Final readiness",
        [
          [
            "arrival-ready",
            "Final walkthrough confirms the property is ready for arrival",
          ],
        ],
      ],
    ],
    Departure: [
      ["Security", [["departure-security", "Property is vacant and secured"]]],
      [
        "Cleanliness",
        [["departure-cleanliness", "Departure cleanliness is documented"]],
      ],
      [
        "Trash",
        [
          [
            "departure-trash",
            "Trash, recycling, and food waste are documented",
          ],
        ],
      ],
      [
        "Damage",
        [["departure-damage", "New interior or exterior damage is documented"]],
      ],
      [
        "Leaks",
        [
          [
            "departure-leaks",
            "Plumbing fixtures and visible areas show no leaks",
          ],
        ],
      ],
      [
        "Missing inventory",
        [
          [
            "departure-inventory",
            "Missing or displaced inventory is documented",
          ],
        ],
      ],
      [
        "Electronics",
        [
          [
            "departure-electronics",
            "TVs, remotes, Wi-Fi, and smart devices are present and normal",
          ],
        ],
      ],
      [
        "Locks and access",
        [
          [
            "departure-locks",
            "Keys, remotes, windows, doors, and access devices are accounted for",
          ],
        ],
      ],
      [
        "Exterior and amenities",
        [
          [
            "departure-amenities",
            "Exterior, pool/spa, grill, and amenities are documented",
          ],
        ],
      ],
      [
        "Belongings left behind",
        [
          [
            "departure-belongings",
            "Guest belongings left behind are documented",
          ],
        ],
      ],
      [
        "Maintenance concerns",
        [
          [
            "departure-maintenance",
            "Maintenance concerns discovered at departure are documented",
          ],
        ],
      ],
      [
        "Overall departure condition",
        [
          [
            "departure-overall",
            "Overall departure condition and turnover needs are documented",
          ],
        ],
      ],
    ],
  };
  function show(n) {
    Object.entries(views).forEach(([k, v]) => (v.hidden = k !== n));
  }
  function esc(v) {
    return String(v || "").replace(
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
  }
  async function api(u, o = {}) {
    const r = await fetch(u, {
        ...o,
        headers: { Accept: "application/json", ...(o.headers || {}) },
      }),
      d = r.status === 204 ? {} : await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Request failed.");
    return d;
  }
  async function boot() {
    try {
      const d = await api("../api/tech/session");
      await signedIn(d.technician);
    } catch {
      show("login");
    }
  }
  async function signedIn(t) {
    $("#logout").hidden = false;
    $("#tech-name").textContent = t.name;
    show("home");
    await loadHome();
  }
  async function loadHome() {
    const [p, c, i, j] = await Promise.all([
      api("../api/tech/properties"),
      api("../api/tech/clients"),
      api("../api/tech/inspections"),
      api("../api/tech/jobs"),
    ]);
    clients = c.clients;
    $("#new-form select[name=propertyId]").innerHTML = p.properties
      .map(
        (x) =>
          `<option value="${x.id}">${esc(x.company_name)} — ${esc(x.name)}</option>`,
      )
      .join("");
    $("#new-property-form select[name=clientId]").innerHTML =
      '<option value="">No existing client — owner review</option>' +
      clients
        .map((x) => `<option value="${x.id}">${esc(x.company_name)}</option>`)
        .join("");
    $("#inspection-list").innerHTML =
      i.inspections
        .map(
          (x) =>
            `<button class="card" data-id="${x.id}"><span class="badge">${esc(x.status)}</span><strong>${esc(x.property_name)}</strong><span>${esc(x.inspection_type)} · ${esc(x.address)}</span></button>`,
        )
        .join("") || "<p>No inspections yet.</p>";
    $$(".card").forEach(
      (x) => (x.onclick = () => openInspection(x.dataset.id)),
    );
    const groups = [
      "assigned",
      "scheduled",
      "in_progress",
      "awaiting_completion_review",
      "completed",
    ];
    $("#job-summary").innerHTML = groups
      .map(
        (status) =>
          `<span class="badge">${esc(status.replaceAll("_", " "))}: ${j.jobs.filter((job) => job.status === status).length}</span>`,
      )
      .join(" ");
    $("#job-list").innerHTML =
      j.jobs
        .map(
          (job) =>
            `<button class="card job-card" data-job="${job.id}"><span class="badge">${esc(job.status.replaceAll("_", " "))}</span><strong>${esc(job.request_number)} · ${esc(job.title)}</strong><span>${esc(job.property_name)} · ${esc(job.address)}</span><span>${esc(job.priority)} · ${esc(job.category)}</span></button>`,
        )
        .join("") || "<p>No assigned service jobs.</p>";
    $$(".job-card").forEach(
      (button) => (button.onclick = () => openJob(button.dataset.job)),
    );
  }
  async function openJob(id) {
    const data = await api(`../api/tech/jobs/${id}`);
    currentJob = data;
    show("job");
    $("#job-number").textContent =
      `${data.job.request_number} · ${data.job.status.replaceAll("_", " ")}`;
    $("#job-title").textContent = data.job.title;
    $("#job-location").textContent =
      `${data.job.property_name} · ${data.job.address}`;
    $("#job-scope").textContent = data.job.description;
    $("#job-context").innerHTML =
      `<p><strong>Priority:</strong> ${esc(data.job.priority)} · <strong>Channel:</strong> ${esc(data.job.category)}</p><p><strong>Access:</strong> ${esc(data.job.access_instructions || "Not provided")}<br><strong>Occupancy:</strong> ${esc(data.job.occupancy_status || "Not provided")}<br><strong>Window:</strong> ${esc(data.job.scheduled_at || data.job.preferred_service_window || "Not scheduled")}</p>${data.job.customer_notes ? `<p><strong>Customer notes:</strong> ${esc(data.job.customer_notes)}</p>` : ""}${data.job.technician_notes ? `<p><strong>TaskCore field notes:</strong> ${esc(data.job.technician_notes)}</p>` : ""}`;
    $("#job-media").innerHTML =
      data.media
        .map((item) => `<p>${esc(item.purpose)} · ${esc(item.file_name)}</p>`)
        .join("") || "<p>No job media yet.</p>";
    $("#job-history").innerHTML =
      data.updates
        .map(
          (item) =>
            `<p><strong>${esc(item.update_type)}</strong> · ${new Date(item.created_at).toLocaleString()}<br>${esc(item.notes)}</p>`,
        )
        .join("") || "<p>No field updates yet.</p>";
    $("#job-ack").disabled = !["assigned", "scheduled"].includes(
      data.job.status,
    );
    $("#job-start").disabled = !["assigned", "scheduled"].includes(
      data.job.status,
    );
    const active = ["assigned", "scheduled", "in_progress"].includes(
      data.job.status,
    );
    $$("input,select,textarea,button", $("#job-update-form")).forEach(
      (control) => (control.disabled = !active),
    );
    $$("input,select,textarea,button", $("#job-completion-form")).forEach(
      (control) => (control.disabled = data.job.status !== "in_progress"),
    );
    scrollTo(0, 0);
  }
  function photoCount(key, findingId) {
    return current.media.filter(
      (m) =>
        m.kind === "Photo" &&
        (key ? m.question_key === key : m.finding_id === findingId),
    ).length;
  }
  function renderChecklist(saved = []) {
    const root = $("#checklist"),
      groups = templates[current.inspection_type] || [];
    root.hidden = !groups.length;
    const by = new Map(saved.map((x) => [x.key, x]));
    root.innerHTML = groups
      .map(
        ([section, items]) =>
          `<section class="panel check-section"><h3>${esc(section)}</h3>${items
            .map(([key, label]) => {
              const x = by.get(key) || {};
              return `<div class="check-item" data-key="${key}" data-section="${esc(section)}" data-label="${esc(label)}"><strong>${esc(label)}</strong><div class="answers">${["Pass", "Issue Found", "Not Applicable"].map((a) => `<label><input type="radio" name="${key}" value="${a}" ${x.answer === a ? "checked" : ""}><span>${a}</span></label>`).join("")}</div><textarea class="item-note" rows="2" placeholder="Issue Found requires an explanation; other notes optional">${esc(x.note)}</textarea><label class="upload"><span>Question photos: ${photoCount(key)} attached (at least 1 required)</span><input type="file" data-question="${key}" accept="image/jpeg,image/png,image/webp,image/heic"></label><label>Linked maintenance finding (optional)<select class="linked-finding"><option value="">None</option>${current.findings.map((f) => `<option value="${f.id}" ${x.findingId === f.id ? "selected" : ""}>${esc(f.title)}</option>`).join("")}</select></label></div>`;
            })
            .join("")}</section>`,
      )
      .join("");
    $$("[data-question]", root).forEach(
      (x) =>
        (x.onchange = () =>
          upload(x.files[0], `question-${x.dataset.question}`, {
            questionKey: x.dataset.question,
          })),
    );
  }
  function addFinding(d = {}) {
    const n = $("#finding-template").content.firstElementChild.cloneNode(true);
    n.dataset.id = d.id || "";
    for (const [name, val] of [
      ["findingCategory", d.category],
      ["findingTitle", d.title],
      ["findingDetails", d.details],
      ["findingPriority", d.priority || "Routine"],
      ["findingSafety", d.immediate_safety_actions],
      ["findingNext", d.recommended_next_steps],
      ["findingMaterials", d.materials_needed],
    ])
      $(`[name=${name}]`, n).value = val || "";
    $(".remove", n).onclick = () => n.remove();
    const slot = $(".finding-upload", n);
    if (d.id) {
      slot.innerHTML = `<span>Finding photos: ${photoCount(null, d.id)} attached (at least 1 required)</span><input type="file" accept="image/jpeg,image/png,image/webp,image/heic">`;
      $("input", slot).onchange = () =>
        upload($("input", slot).files[0], "finding", { findingId: d.id });
    } else
      slot.innerHTML =
        "<span>Save draft to attach photos to this finding.</span>";
    $("#findings").append(n);
  }
  function renderMedia() {
    $("#uploaded-media").innerHTML = current.media
      .map(
        (x) =>
          `<div class="media-row"><span>${esc(x.kind)} · ${esc(x.file_name)}</span>${["Draft", "Needs Changes"].includes(current.status) ? `<button type="button" data-media="${x.id}">Remove</button>` : ""}</div>`,
      )
      .join("");
    $$("[data-media]").forEach(
      (b) =>
        (b.onclick = async () => {
          await api(
            `../api/tech/inspections/${current.id}/media/${b.dataset.media}`,
            { method: "DELETE" },
          );
          await openInspection(current.id);
        }),
    );
  }
  async function upload(file, category, link = {}) {
    if (!file) return;
    const q = new URLSearchParams({ category, ...link });
    $("#editor-status").textContent = `Uploading ${file.name}…`;
    await api(`../api/tech/inspections/${current.id}/media?${q}`, {
      method: "POST",
      headers: { "Content-Type": file.type, "X-File-Name": file.name },
      body: file,
    });
    await openInspection(current.id);
  }
  async function openInspection(id) {
    history.replaceState(null, "", `#inspection-${id}`);
    const { inspection } = await api(`../api/tech/inspections/${id}`);
    current = inspection;
    show("editor");
    $("#editor-type").textContent =
      `${inspection.inspection_type} · ${inspection.status}`;
    $("#editor-property").textContent = inspection.property_name;
    $("#editor-address").textContent = inspection.address;
    $("[name=summary]").value = inspection.summary || "";
    $("#findings").replaceChildren();
    inspection.findings.forEach(addFinding);
    renderChecklist(inspection.checklist);
    renderMedia();
    $("#maintenance-help").hidden =
      inspection.inspection_type !== "Maintenance Documentation";
    const e = ["Draft", "Needs Changes"].includes(inspection.status);
    $$(
      "#inspection-form input,#inspection-form select,#inspection-form textarea,#inspection-form button",
    ).forEach((f) => (f.disabled = !e));
    $("#editor-status").textContent = e
      ? inspection.review_note
        ? `Owner note: ${inspection.review_note}`
        : ""
      : "Submitted to owner review.";
    scrollTo(0, 0);
  }
  function draft() {
    return {
      operationId: crypto.randomUUID(),
      summary: $("[name=summary]").value,
      checklist: $$(".check-item").map((x) => ({
        key: x.dataset.key,
        section: x.dataset.section,
        label: x.dataset.label,
        answer: $("input:checked", x)?.value || "",
        note: $(".item-note", x).value,
        findingId: $(".linked-finding", x).value || null,
      })),
      findings: $$(".finding").map((x) => ({
        id: x.dataset.id || undefined,
        category: $("[name=findingCategory]", x).value,
        title: $("[name=findingTitle]", x).value,
        details: $("[name=findingDetails]", x).value,
        priority: $("[name=findingPriority]", x).value,
        immediateSafetyActions: $("[name=findingSafety]", x).value,
        recommendedNextSteps: $("[name=findingNext]", x).value,
        materialsNeeded: $("[name=findingMaterials]", x).value,
      })),
    };
  }
  async function save() {
    return api(`../api/tech/inspections/${current.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft()),
    }).then(() => openInspection(current.id));
  }
  $("#login-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const d = await api("../api/tech/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      await signedIn(d.technician);
    } catch (x) {
      $("output", e.currentTarget).textContent = x.message;
    }
  };
  $("#logout").onclick = async () => {
    await api("../api/tech/logout", { method: "POST" });
    location.reload();
  };
  $("#show-new").onclick = () => ($("#new-form").hidden = false);
  $("#show-add-property").onclick = () => {
    $("#new-form").hidden = true;
    $("#new-property-form").hidden = false;
  };
  $("#cancel-new").onclick = () => ($("#new-form").hidden = true);
  $("#cancel-add-property").onclick = () => {
    $("#new-property-form").hidden = true;
    $("#new-form").hidden = false;
  };
  for (const id of ["new-form", "new-property-form"])
    $("#" + id).onsubmit = async (e) => {
      e.preventDefault();
      try {
        const d = await api(
          id === "new-form"
            ? "../api/tech/inspections"
            : "../api/tech/properties",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              Object.fromEntries(new FormData(e.currentTarget)),
            ),
          },
        );
        await openInspection(d.id || d.inspectionId);
      } catch (x) {
        $("output", e.currentTarget).textContent = x.message;
      }
    };
  $("#back-home").onclick = async () => {
    show("home");
    await loadHome();
  };
  $("#back-jobs").onclick = async () => {
    show("home");
    await loadHome();
  };
  $("#job-ack").onclick = async () => {
    await api(`../api/tech/jobs/${currentJob.job.id}/acknowledge`, {
      method: "POST",
    });
    await openJob(currentJob.job.id);
  };
  $("#job-start").onclick = async () => {
    await api(`../api/tech/jobs/${currentJob.job.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in_progress" }),
    });
    await openJob(currentJob.job.id);
  };
  $("#job-update-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget,
      values = Object.fromEntries(new FormData(form));
    values.timeSpentMinutes = values.timeSpentMinutes
      ? Number(values.timeSpentMinutes)
      : null;
    try {
      await api(`../api/tech/jobs/${currentJob.job.id}/updates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      form.reset();
      await openJob(currentJob.job.id);
    } catch (error) {
      $("output", form).textContent = error.message;
    }
  };
  $("#job-photo").onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    await api(
      `../api/tech/jobs/${currentJob.job.id}/media?purpose=${encodeURIComponent($("#job-photo-purpose").value)}`,
      {
        method: "POST",
        headers: { "Content-Type": file.type, "X-File-Name": file.name },
        body: file,
      },
    );
    await openJob(currentJob.job.id);
  };
  $("#job-completion-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget,
      values = Object.fromEntries(new FormData(form));
    values.timeSpentMinutes = Number(values.timeSpentMinutes);
    try {
      await api(`../api/tech/jobs/${currentJob.job.id}/completion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      await openJob(currentJob.job.id);
    } catch (error) {
      $("output", form).textContent = error.message;
    }
  };
  $("#add-finding").onclick = () => addFinding();
  $("#save-draft").onclick = () =>
    save().catch((e) => ($("#editor-status").textContent = e.message));
  $("#walkthrough").onchange = (e) => upload(e.target.files[0], "walkthrough");
  $("#inspection-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await save();
      await api(`../api/tech/inspections/${current.id}/submit`, {
        method: "POST",
      });
      await openInspection(current.id);
    } catch (x) {
      $("#editor-status").textContent = x.message;
    }
  };
  boot();
})();
