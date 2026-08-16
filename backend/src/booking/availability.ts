import type { Kysely } from "kysely";
import type { TaskCoreDatabase } from "../types.js";
import type { BookableService } from "./services.js";
import { signSession, type SlotSession } from "./session.js";

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value("weekday")) };
}

function zonedLocalToUtc(date: string, hour: number, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number); let guess = Date.UTC(year!, month! - 1, day!, hour);
  for (let i = 0; i < 2; i += 1) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    guess -= Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute")) - Date.UTC(year!, month! - 1, day!, hour);
  }
  return new Date(guess);
}

export async function releaseExpiredReservations(db: Kysely<TaskCoreDatabase>, now: string): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const stale = await trx.selectFrom("slot_reservations").selectAll().where("expires_at", "<=", now).execute();
    const holds = stale.flatMap((row) => row.hold_id ? [row.hold_id] : []); const bookings = stale.flatMap((row) => row.booking_id ? [row.booking_id] : []);
    if (holds.length) await trx.updateTable("booking_holds").set({ status: "expired", updated_at: now }).where("id", "in", holds).where("status", "=", "active").execute();
    if (bookings.length) await trx.updateTable("bookings").set({ status: "expired", updated_at: now }).where("id", "in", bookings).where("status", "=", "pending_payment").execute();
    if (stale.length) await trx.deleteFrom("slot_reservations").where("slot_key", "in", stale.map((row) => row.slot_key)).execute();
  });
}

export async function generateAvailability(db: Kysely<TaskCoreDatabase>, service: BookableService, input: { timezone: string; secret: string; now: Date; days?: number }) {
  await releaseExpiredReservations(db, input.now.toISOString());
  const reservations = new Set((await db.selectFrom("slot_reservations").select("slot_key").execute()).map((row) => row.slot_key));
  const slots: Array<{ id: string; start: string; end: string; timezone: string; label: string }> = [];
  const days = Math.min(Math.max(input.days ?? 14, 1), 31);
  for (let offset = 1; offset <= days; offset += 1) {
    const local = localParts(new Date(input.now.getTime() + offset * 86_400_000), input.timezone);
    if (!service.scheduling.weekdays.includes(local.weekday)) continue;
    for (const hour of service.scheduling.localStartHours) {
      const start = zonedLocalToUtc(local.date, hour, input.timezone); const end = new Date(start.getTime() + service.durationMinutes * 60_000);
      const startIso = start.toISOString(); const endIso = end.toISOString();
      if (reservations.has(`${startIso}|${endIso}|${input.timezone}`)) continue;
      const payload: SlotSession = { type: "slot", serviceId: service.id, start: startIso, end: endIso, timezone: input.timezone, exp: Math.floor(input.now.getTime() / 1000) + 600 };
      slots.push({ id: signSession(payload, input.secret), start: startIso, end: endIso, timezone: input.timezone,
        label: new Intl.DateTimeFormat("en-US", { timeZone: input.timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(start) });
    }
  }
  return slots;
}
