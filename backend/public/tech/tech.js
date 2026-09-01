(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s),
    $$ = (s, r = document) => [...r.querySelectorAll(s)],
    views = {
      login: $("#login-view"),
      home: $("#home-view"),
      editor: $("#editor-view"),
      job: $("#job-view"),
      task: $("#task-view"),
    };
  let current = null,
    currentJob = null,
    clients = [],
    taskStep = 1,
    inspectionStep = 1,
    taskSaveTimer = null;
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
    $("#new-task-form select[name=propertyId]").innerHTML = '<option value="">Add an address — owner assignment</option>' + p.properties
      .map((x) => `<option value="${x.id}">${esc(x.name)} — ${esc(x.address)}</option>`)
      .join("");
    const activeInspections = i.inspections.filter((x) => ["Draft", "Needs Changes"].includes(x.status));
    const completedInspections = i.inspections.filter((x) => !["Draft", "Needs Changes"].includes(x.status));
    const activeJobs = j.jobs.filter((x) => ["assigned", "scheduled", "in_progress", "needs_information"].includes(x.status));
    const completedJobs = j.jobs.filter((x) => ["owner_review", "awaiting_completion_review", "completed", "closed", "declined"].includes(x.status));
    $("#active-count").textContent = `${activeInspections.length + activeJobs.length} active`;
    $("#completed-count").textContent = `${completedInspections.length + completedJobs.length} recent`;
    $("#inspection-list").innerHTML =
      activeInspections
        .map(
          (x) =>
            `<button class="card" data-id="${x.id}"><span class="badge">${esc(x.status)}</span><strong>${esc(x.property_name)}</strong><span>${esc(x.inspection_type)} · ${esc(x.address)}</span></button>`,
        )
        .join("") || "";
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
      activeJobs
        .map(
          (job) =>
            `<button class="card job-card" data-job="${job.id}" data-task="${job.task_type ? "true" : "false"}"><span class="badge">${esc(job.review_status || job.status.replaceAll("_", " "))}</span><strong>${esc(job.title)}</strong><span>${esc(job.property_name)} · ${esc(job.address)}</span><span>${esc(job.task_type || "Assigned service call")}</span></button>`,
        )
        .join("") || "<p>No assigned service jobs.</p>";
    $$(".job-card").forEach(
      (button) => (button.onclick = () => button.dataset.task === "true" ? openTask(button.dataset.job) : openJob(button.dataset.job)),
    );
    $("#completed-list").innerHTML = [...completedInspections.map((x) => ({ id: x.id, kind: "inspection", title: `${x.inspection_type} inspection`, property: x.property_name, status: x.status, date: x.updated_at })), ...completedJobs.map((x) => ({ id: x.id, kind: x.task_type ? "task" : "job", title: x.task_type || x.title, property: x.property_name, status: x.review_status || x.status, date: x.updated_at }))]
      .sort((a,b) => String(b.date).localeCompare(String(a.date))).map((x) => `<button class="card completed-card" data-kind="${x.kind}" data-id="${x.id}"><strong>${esc(x.property)}</strong><span>${esc(x.title)} · ${esc(x.status)}</span><span>${new Date(x.date).toLocaleDateString()}</span></button>`).join("") || "<p>No completed jobs yet.</p>";
    $$(".completed-card").forEach((button) => button.onclick = () => button.dataset.kind === "inspection" ? openInspection(button.dataset.id) : button.dataset.kind === "task" ? openTask(button.dataset.id) : openJob(button.dataset.id));
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
  function taskDraft() {
    const values = Object.fromEntries(new FormData($("#task-form")));
    for (const key of ["estimatedLaborHours", "estimatedMaterialCost", "proposedLabor", "proposedTotal"])
      values[key] = values[key] === "" ? null : Number(values[key]);
    values.specialistNeeded = $("[name=specialistNeeded]").checked;
    values.operationId = crypto.randomUUID();
    return values;
  }
  function renderTaskStep() {
    const isQuote = currentJob.task.task_type === "Quote / Estimate Request";
    $$(".task-step").forEach((step) => {
      const number = Number(step.dataset.taskStep);
      step.hidden = number !== taskStep || (number === 4 && !isQuote);
    });
    if (!isQuote && taskStep === 4) taskStep = 5;
    $("#task-step-label").textContent = `Step ${taskStep} of 6`;
    $("#task-progress").value = taskStep;
    $("#task-back").disabled = taskStep === 1;
    $("#task-next").hidden = taskStep === 6;
    if (taskStep === 5) {
      const d = taskDraft();
      $("#task-review").innerHTML = `<p><strong>Findings</strong><br>${esc(d.findings || "Not entered")}</p><p><strong>Recommended next step</strong><br>${esc(d.recommendedRepair || "Not entered")}</p><p><strong>Media</strong><br>${currentJob.media.length} attached</p>${isQuote ? `<p><strong>Proposed total</strong><br>$${Number(d.proposedTotal || 0).toFixed(2)}</p><p class="callout">This is a quote for TaskCore review. Work is not authorized by submission.</p>` : ""}`;
    }
  }
  async function saveTask(quiet = true) {
    if (!currentJob?.task || currentJob.task.submitted_at) return;
    const cacheKey = `taskcore-task-${currentJob.job.id}`;
    const payload = taskDraft();
    localStorage.setItem(cacheKey, JSON.stringify(payload));
    if (!quiet) $("#task-status").textContent = "Saving…";
    try {
      await api(`../api/tech/tasks/${currentJob.job.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      localStorage.removeItem(cacheKey);
      $("#task-status").textContent = "Saved";
    } catch (error) {
      $("#task-status").textContent = navigator.onLine ? error.message : "Offline — saved on device";
    }
  }
  async function openTask(id) {
    const data = await api(`../api/tech/jobs/${id}`);
    if (!data.task) return openJob(id);
    currentJob = data; taskStep = 1; show("task");
    $("#task-type").textContent = `${data.task.task_type} · ${data.task.review_status}`;
    $("#task-title").textContent = data.job.title;
    $("#task-location").textContent = `${data.job.property_name} · ${data.job.address}`;
    const recovered = JSON.parse(localStorage.getItem(`taskcore-task-${id}`) || "null") || {};
    const values = { findings: data.task.findings, measurementsNotes: data.task.measurements_notes, recommendedRepair: data.task.recommended_repair, specialistNeeded: Boolean(data.task.specialist_needed), estimatedLaborHours: data.task.estimated_labor_hours, estimatedMaterials: data.task.estimated_materials, estimatedMaterialCost: data.task.estimated_material_cost_cents == null ? "" : data.task.estimated_material_cost_cents / 100, proposedLabor: data.task.proposed_labor_cents == null ? "" : data.task.proposed_labor_cents / 100, proposedTotal: data.task.proposed_total_cents == null ? "" : data.task.proposed_total_cents / 100, ...recovered };
    for (const [name, value] of Object.entries(values)) { const control = $(`[name=${name}]`); if (!control) continue; if (control.type === "checkbox") control.checked = Boolean(value); else control.value = value ?? ""; }
    $("#task-media-list").innerHTML = data.media.map((item) => `<p>${esc(item.kind)} · ${esc(item.file_name)}</p>`).join("") || "<p>No photos or videos yet.</p>";
    const editable = !data.task.submitted_at && ["in_progress", "needs_information"].includes(data.job.status);
    $$("input,textarea,select,button", $("#task-form")).forEach((control) => control.disabled = !editable);
    $("#task-status").textContent = recovered.findings ? "Your unfinished work was restored." : editable ? "Saved" : `Submitted · ${data.task.review_status}`;
    renderTaskStep(); scrollTo(0, 0);
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
  function renderInspectionStep() {
    const questionSections = $$(".check-section");
    questionSections.forEach((section, index) => {
      const step = 2 + Math.min(2, Math.floor(index * 3 / Math.max(1, questionSections.length)));
      section.hidden = inspectionStep !== step && inspectionStep !== 7;
    });
    const panels = $$("#inspection-form > .panel");
    panels.forEach((panel, index) => panel.hidden = inspectionStep !== (index < 1 ? 5 : 6) && inspectionStep !== 7);
    $("#inspection-step-back").disabled = inspectionStep === 1;
    $("#inspection-step-next").hidden = inspectionStep === 7;
    $("#save-draft").hidden = inspectionStep === 7;
    $("#inspection-form > .sticky-actions button[type=submit]").hidden = inspectionStep !== 7;
    $("#editor-status").textContent = `Step ${inspectionStep} of 7${inspectionStep === 1 ? " · Confirm the property above" : inspectionStep === 5 ? " · Photos and walkthrough" : inspectionStep === 6 ? " · Findings and notes" : inspectionStep === 7 ? " · Review and submit" : ""}`;
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
    inspectionStep = 1;
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
    renderInspectionStep();
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
    const savedStep = inspectionStep;
    return api(`../api/tech/inspections/${current.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft()),
    }).then(() => openInspection(current.id)).then(() => { inspectionStep = savedStep; renderInspectionStep(); });
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
  $("#show-new-task").onclick = () => ($("#new-task-form").hidden = false);
  $("#cancel-new-task").onclick = () => ($("#new-task-form").hidden = true);
  $("#show-active").onclick = () => { $("#active-work").hidden = !$("#active-work").hidden; $("#completed-work").hidden = true; };
  $("#show-completed").onclick = () => { $("#completed-work").hidden = !$("#completed-work").hidden; $("#active-work").hidden = true; };
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
  $("#new-task-form").onsubmit = async (event) => {
    event.preventDefault(); const form = event.currentTarget;
    try {
      const payload = Object.fromEntries(new FormData(form)); payload.operationId = crypto.randomUUID();
      if (!payload.propertyId) payload.property = { name: payload.propertyName, streetAddress: payload.streetAddress, city: payload.city, state: payload.state, postalCode: payload.postalCode };
      for (const key of ["propertyName", "streetAddress", "city", "state", "postalCode"]) delete payload[key];
      const created = await api("../api/tech/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      form.reset(); await openTask(created.id);
    } catch (error) { $("output", form).textContent = error.message; }
  };
  $("#back-home").onclick = async () => {
    show("home");
    await loadHome();
  };
  $("#back-jobs").onclick = async () => {
    show("home");
    await loadHome();
  };
  $("#back-tasks").onclick = async () => { await saveTask(); show("home"); await loadHome(); };
  $("#task-form").addEventListener("input", () => { clearTimeout(taskSaveTimer); $("#task-status").textContent = "Saving…"; taskSaveTimer = setTimeout(() => saveTask(), 700); });
  $("#task-next").onclick = async () => { await saveTask(); taskStep = Math.min(6, taskStep + 1); if (taskStep === 4 && currentJob.task.task_type !== "Quote / Estimate Request") taskStep = 5; renderTaskStep(); scrollTo(0, 0); };
  $("#task-back").onclick = () => { taskStep = Math.max(1, taskStep - 1); if (taskStep === 4 && currentJob.task.task_type !== "Quote / Estimate Request") taskStep = 3; renderTaskStep(); scrollTo(0, 0); };
  $("#task-media").onchange = async (event) => { const file = event.target.files[0]; if (!file) return; $("#task-status").textContent = "Uploading…"; try { await api(`../api/tech/jobs/${currentJob.job.id}/media?purpose=Task`, { method: "POST", headers: { "Content-Type": file.type, "X-File-Name": file.name }, body: file }); await openTask(currentJob.job.id); taskStep = 2; renderTaskStep(); } catch { $("#task-status").textContent = "Photo upload paused. We'll retry automatically."; } };
  $("#submit-task").onclick = async () => { try { await saveTask(false); await api(`../api/tech/tasks/${currentJob.job.id}/submit`, { method: "POST" }); localStorage.removeItem(`taskcore-task-${currentJob.job.id}`); await openTask(currentJob.job.id); } catch (error) { $("#task-status").textContent = error.message; } };
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
  $("#inspection-step-next").onclick = async () => { try { if (inspectionStep > 1) await save(); inspectionStep = Math.min(7, inspectionStep + 1); renderInspectionStep(); scrollTo(0, 0); } catch (error) { $("#editor-status").textContent = error.message; } };
  $("#inspection-step-back").onclick = () => { inspectionStep = Math.max(1, inspectionStep - 1); renderInspectionStep(); scrollTo(0, 0); };
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
