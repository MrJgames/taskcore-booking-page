import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { formatMoney, PaymentAttemptController, safeCustomerState } from "../booking-flow-core.mjs";

const root = new URL("../", import.meta.url);
const html = fs.readFileSync(new URL("index.html", root), "utf8");
const booking = fs.readFileSync(new URL("booking.js", root), "utf8");
const worker = fs.readFileSync(new URL("service-worker.js", root), "utf8");
const styles = fs.readFileSync(new URL("styles.css", root), "utf8");

test("money is formatted only from integer cents", () => { assert.equal(formatMoney(5000), "$50.00"); assert.throws(() => formatMoney(50.5)); });
test("double click cannot start a second payment", () => { const attempts = new PaymentAttemptController(() => "stable-id"); assert.equal(attempts.begin(), "stable-id"); assert.equal(attempts.begin(), null); });
test("transport retry keeps the logical request ID", () => { const attempts = new PaymentAttemptController(() => "stable-id"); attempts.begin(); attempts.interrupted(); assert.equal(attempts.begin(), "stable-id"); });
test("terminal decline permits a deliberate new attempt ID", () => { let id = 0; const attempts = new PaymentAttemptController(() => `id-${++id}`); assert.equal(attempts.begin(), "id-1"); attempts.declined(); assert.equal(attempts.begin(), "id-2"); });
test("unknown status remains reconciliation-safe", () => assert.equal(safeCustomerState("mystery"), "processing"));
test("tokenization alone does not render confirmation", () => { const tokenIndex = booking.indexOf("card.tokenize"); const backendIndex = booking.indexOf("deposit-payment", tokenIndex); const confirmIndex = booking.indexOf("renderConfirmation", backendIndex); assert.ok(tokenIndex > -1 && backendIndex > tokenIndex && confirmIndex > backendIndex); });
test("confirmation refresh reconciles without repaying", () => { assert.match(booking, /pageshow[^]*reconcile/); assert.doesNotMatch(booking, /pageshow[^]*deposit-payment/); });
test("payment and booking APIs are never service-worker cached", () => { assert.match(worker, /method !== "GET"/); assert.match(worker, /pathname\.includes\("\/api\/"\)/); });
test("card and Square tokens are not persisted in browser storage", () => { assert.doesNotMatch(booking, /localStorage|sessionStorage|indexedDB/); assert.doesNotMatch(html, /cardNumber|cvv|sourceToken/); });
test("booking controls provide labels, live status, and semantic fieldsets", () => { assert.match(html, /role="status" aria-live="polite"/); assert.match(html, /<fieldset>/); assert.match(html, /<legend>/); assert.match(html, /autocomplete="street-address"/); });
test("narrow mobile layouts avoid fixed content width", () => { assert.match(styles, /@media\(max-width:360px\)/); assert.match(styles, /booking-choices,.booking-slots\{grid-template-columns:1fr\}/); assert.doesNotMatch(styles, /\.booking-shell\{width:\d+px/); });
test("Square uses current tokenize verification details", () => { assert.match(booking, /customerInitiated: true/); assert.match(booking, /sellerKeyedIn: false/); assert.doesNotMatch(booking, /verifyBuyer/); });
