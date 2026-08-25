import type { AppConfig } from "./config.js";

export async function sendOwnerReviewText(config: AppConfig, message: string): Promise<"sent" | "not-configured" | "failed"> {
  if (!config.ownerMobileNumber || !config.twilioAccountSid || !config.twilioAuthToken || !config.twilioFromNumber) {
    return "not-configured";
  }
  try {
    const body = new URLSearchParams({ To: config.ownerMobileNumber, From: config.twilioFromNumber, Body: message });
    const authorization = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString("base64");
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.twilioAccountSid)}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${authorization}`, "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

export async function sendClientReportEmail(config: AppConfig, recipient: string, company: string, property: string, reportUrl: string): Promise<"sent" | "not-configured" | "failed"> {
  if (!config.resendApiKey || !config.reportFromEmail) return "not-configured";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: config.reportFromEmail,
        to: [recipient],
        subject: `TaskCore inspection report — ${property}`,
        html: `<p>Hello ${escapeHtml(company)},</p><p>Your TaskCore property inspection report is ready. Review the findings and approve or decline each proposed repair using the secure link below.</p><p><a href="${escapeHtml(reportUrl)}">Review inspection report</a></p><p>This link expires in ${config.reportTokenDays} days.</p>`
      })
    });
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character));
}
