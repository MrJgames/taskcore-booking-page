import { formatMoney, PaymentAttemptController, safeCustomerState } from "./booking-flow-core.mjs";

const localMockSquare = ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("mockSquare");
const apiBase = localMockSquare ? location.origin : (typeof TASKCORE_API_URL === "string" ? TASKCORE_API_URL.trim().replace(/\/$/, "") : "");
const root = document.getElementById("booking-flow");
if (localMockSquare && !window.Square) {
  window.Square = { payments: () => ({ card: async () => ({ attach: async (selector) => { document.querySelector(selector).innerHTML = '<div class="mock-square-fields" role="group" aria-label="Mocked Square card fields"><span>Card number</span><span>MM/YY</span><span>CVV</span></div>'; }, tokenize: async () => ({ status: "OK", token: `mock-${new URLSearchParams(location.search).get("mockSquare")}` }) }) }) };
}
if (root) {
  const status = document.getElementById("booking-status"); const form = document.getElementById("booking-form");
  const servicesEl = document.getElementById("booking-services"); const slotsEl = document.getElementById("booking-slots");
  const review = document.getElementById("booking-review"); const paymentPanel = document.getElementById("booking-payment");
  const confirmation = document.getElementById("booking-confirmation"); const continueButton = document.getElementById("booking-continue");
  const paymentButton = document.getElementById("booking-pay"); const quoteLink = document.getElementById("booking-quote-link");
  const attempts = new PaymentAttemptController(); let services = []; let selectedService = null; let selectedSlot = null;
  let checkout = null; let card = null;
  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character]);

  function announce(message, kind = "") { status.textContent = message; status.className = `booking-status ${kind}`.trim(); }
  function showStage(name) {
    root.querySelectorAll("[data-booking-stage]").forEach((panel) => { panel.hidden = panel.dataset.bookingStage !== name; });
    root.dataset.state = name; root.querySelector(`[data-booking-stage="${name}"] h3`)?.focus({ preventScroll: true });
  }
  async function api(path, options) {
    if (!apiBase) throw new Error("Online booking is not configured. Please request a quote.");
    const response = await fetch(`${apiBase}${path}`, { ...options, headers: { Accept: "application/json", ...(options?.body ? { "Content-Type": "application/json" } : {}) }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || "The request could not be completed."); error.status = response.status; throw error; }
    return data;
  }
  function serviceMarkup(service) {
    const price = service.pricing.kind === "quote_required" ? "Quote required" : `${formatMoney(service.pricing.totalCents)} estimate · ${formatMoney(service.pricing.depositCents)} deposit`;
    return `<label class="booking-choice"><input type="radio" name="bookingService" value="${escapeHtml(service.id)}"><span><strong>${escapeHtml(service.displayName)}</strong><small>${escapeHtml(service.description)}</small><em>${escapeHtml(price)}</em></span></label>`;
  }
  async function loadServices() {
    announce("Loading booking options…");
    try { const data = await api("/api/booking/services"); services = data.services; servicesEl.innerHTML = services.map(serviceMarkup).join(""); announce("Choose a service to continue."); }
    catch (error) { announce(error.message, "error"); quoteLink.hidden = false; }
  }
  servicesEl.addEventListener("change", async (event) => {
    selectedService = services.find((item) => item.id === event.target.value); selectedSlot = null; slotsEl.replaceChildren();
    if (!selectedService?.directlyBookable) { announce("This service needs a quote before scheduling. The quote form remains available below.", "notice"); quoteLink.hidden = false; continueButton.disabled = true; return; }
    quoteLink.hidden = true; continueButton.disabled = true; announce("Loading available appointments…");
    try { const data = await api(`/api/booking/availability?serviceId=${encodeURIComponent(selectedService.id)}`); slotsEl.innerHTML = data.slots.length ? data.slots.map((slot) => `<label class="slot-choice"><input type="radio" name="slot" value="${escapeHtml(slot.id)}"><span>${escapeHtml(slot.label)}</span></label>`).join("") : "<p>No appointments are currently available. Please request a quote or contact TaskCore.</p>"; announce("Select an available appointment."); }
    catch (error) { announce(error.message, "error"); }
  });
  slotsEl.addEventListener("change", (event) => { selectedSlot = event.target.value; continueButton.disabled = false; announce("Appointment selected. Enter your information and continue."); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); if (!selectedService || !selectedSlot || !form.reportValidity()) return;
    continueButton.disabled = true; continueButton.setAttribute("aria-busy", "true"); announce("Preparing and holding your booking…");
    const values = new FormData(form); const payload = { serviceId: selectedService.id, slotId: selectedSlot, name: values.get("name"), phone: values.get("phone"), email: values.get("email"), address: values.get("address"), notes: values.get("notes") };
    try { checkout = await api("/api/booking/checkout-session", { method: "POST", body: JSON.stringify(payload) }); renderReview(); showStage("review"); announce("Your appointment is held temporarily. Review the deposit before paying.", "success"); }
    catch (error) { announce(error.message, "error"); if (error.status === 409) selectedSlot = null; continueButton.disabled = false; }
    finally { continueButton.removeAttribute("aria-busy"); }
  });
  function renderReview() {
    const value = checkout; review.innerHTML = `<dl><div><dt>Service</dt><dd>${escapeHtml(value.service.displayName)}</dd></div><div><dt>Customer</dt><dd>${escapeHtml(value.customer.name)}</dd></div><div><dt>Address</dt><dd>${escapeHtml(value.address)}</dd></div><div><dt>Appointment</dt><dd>${escapeHtml(new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short", timeZone: value.appointment.timezone }).format(new Date(value.appointment.start)))}</dd></div><div><dt>Estimated total</dt><dd>${formatMoney(value.money.totalCents)}</dd></div><div><dt>Deposit due today</dt><dd><strong>${formatMoney(value.money.dueTodayCents)}</strong></dd></div><div><dt>Remaining balance</dt><dd>${formatMoney(value.money.remainingBalanceCents)}</dd></div></dl><p class="policy-note">${escapeHtml(value.policyText)}</p><p class="hold-note">Hold expires ${escapeHtml(new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone: value.appointment.timezone }).format(new Date(value.holdExpiresAt)))}.</p>`;
  }
  document.getElementById("booking-to-payment").addEventListener("click", async () => { showStage("payment"); await initializeSquare(); });
  async function loadSquare(url) {
    if (window.Square) return; await new Promise((resolve, reject) => { const script = document.createElement("script"); script.src = url; script.onload = resolve; script.onerror = () => reject(new Error("Secure payment fields could not load.")); document.head.append(script); });
  }
  async function initializeSquare() {
    announce("Preparing secure payment fields…");
    if (!checkout.payment) { announce("Square Sandbox is not configured on the server. No payment was attempted.", "error"); return; }
    if (!window.isSecureContext && !["localhost", "127.0.0.1"].includes(location.hostname)) { announce("Secure payment requires HTTPS.", "error"); return; }
    try { await loadSquare(checkout.payment.sdkUrl); const payments = window.Square.payments(checkout.payment.applicationId, checkout.payment.locationId); card = await payments.card({ style: { input: { fontSize: "16px" }, ".input-container.is-focus": { borderColor: "#f7b733" } } }); await card.attach("#square-card-container"); paymentButton.disabled = false; announce("Secure payment form ready.", "success"); }
    catch (error) { announce(error.name === "BrowserNotSupportedError" ? "This browser cannot use secure payment. Please try a current browser." : error.message, "error"); }
  }
  paymentButton.addEventListener("click", async () => {
    if (!card || attempts.processing) return; const requestId = attempts.begin(); if (!requestId) return;
    paymentButton.disabled = true; paymentButton.setAttribute("aria-busy", "true"); announce("Processing your deposit securely…");
    if (localMockSquare && new URLSearchParams(location.search).get("mockSquare") === "expired") { attempts.interrupted(); paymentButton.removeAttribute("aria-busy"); announce("The appointment hold expired. No payment was attempted.", "error"); return; }
    try {
      const name = String(new FormData(form).get("name") || "").trim().split(/\s+/); const money = checkout.money;
      const tokenized = await card.tokenize({ amount: (money.dueTodayCents / 100).toFixed(2), currencyCode: money.currency, intent: "CHARGE", customerInitiated: true, sellerKeyedIn: false,
        billingContact: { givenName: name[0], familyName: name.slice(1).join(" "), email: new FormData(form).get("email") || undefined, phone: new FormData(form).get("phone"), addressLines: [new FormData(form).get("address")], countryCode: "US" } });
      if (tokenized.status !== "OK" || !tokenized.token) throw new Error("Card details could not be tokenized. Check the fields and try again.");
      const result = await api(`/api/bookings/${checkout.bookingId}/deposit-payment`, { method: "POST", body: JSON.stringify({ sourceToken: tokenized.token, requestId, paymentSessionToken: checkout.paymentSessionToken }) });
      if (result.status === "paid") { attempts.confirmed(); await reconcile(); return; }
      attempts.pending(); announce("Payment is processing. Checking TaskCore for confirmation…", "notice"); await reconcile();
    } catch (error) {
      if (error.status === 402) { attempts.declined(); announce("The payment was declined. You may deliberately try another payment method.", "error"); paymentButton.textContent = "Try another payment method"; paymentButton.disabled = false; }
      else { attempts.interrupted(); announce("The connection was interrupted. Checking TaskCore before another payment attempt…", "notice"); await reconcile(); }
    } finally { paymentButton.removeAttribute("aria-busy"); }
  });
  async function reconcile() {
    try {
      const latest = await api(`/api/booking/session/${encodeURIComponent(checkout.paymentSessionToken)}/status`); const state = safeCustomerState(latest.state);
      if (state === "confirmed") { attempts.confirmed(); renderConfirmation(latest); showStage("confirmation"); announce("Appointment confirmed.", "success"); return; }
      if (state === "expired") { announce("The appointment hold expired. No new payment was attempted.", "error"); return; }
      if (state === "failed") { attempts.declined(); paymentButton.disabled = false; announce("The prior attempt was declined. You may choose to try again.", "error"); return; }
      paymentButton.disabled = true; announce("Payment is still being reconciled. Please wait; do not submit another payment.", "notice");
    } catch (error) { paymentButton.disabled = true; announce("TaskCore cannot yet verify the payment result. Please contact TaskCore before retrying.", "error"); }
  }
  function renderConfirmation(value) {
    confirmation.innerHTML = `<p class="confirmation-kicker">Appointment Confirmed</p><h3 tabindex="-1">You’re on the schedule.</h3><dl><div><dt>Reference</dt><dd>${escapeHtml(value.reference)}</dd></div><div><dt>Service</dt><dd>${escapeHtml(value.service.displayName)}</dd></div><div><dt>Customer</dt><dd>${escapeHtml(value.customer.name)}</dd></div><div><dt>Address</dt><dd>${escapeHtml(value.address)}</dd></div><div><dt>Appointment</dt><dd>${escapeHtml(new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short", timeZone: value.appointment.timezone }).format(new Date(value.appointment.start)))}</dd></div><div><dt>Deposit paid</dt><dd>${formatMoney(value.money.paidDepositCents)}</dd></div><div><dt>Remaining balance</dt><dd>${formatMoney(value.money.remainingBalanceCents)}</dd></div></dl><p>TaskCore will contact you if any preparation details are needed. Questions? Call or text <a href="tel:+14428225357">(442) 822-5357</a>.</p>`;
  }
  window.addEventListener("pageshow", () => { if (checkout?.paymentSessionToken) reconcile(); });
  loadServices();
}
