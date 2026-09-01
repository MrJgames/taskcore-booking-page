import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import express, { type RequestHandler } from "express";
import { z } from "zod";
import type { Kysely } from "kysely";
import type { AppConfig } from "./config.js";
import {
  createOpaqueToken,
  createTechnicianAuth,
  hashPassword,
  hashToken,
  verifyPassword,
  type TechnicianRequest,
} from "./auth.js";
import {
  persistMedia,
  receiveUpload,
  sendMedia,
  stagedMediaPath,
  uploadExtension,
} from "./media.js";
import {
  OPERATIONS_REQUEST_STATUSES,
  type OperationsRequestStatus,
  type TaskCoreDatabase,
} from "./types.js";

const managerDirectory = fileURLToPath(
  new URL("../public/manager/", import.meta.url),
);
const contractorDirectory = fileURLToPath(
  new URL("../public/contractor/", import.meta.url),
);
const sharedOperationsStyles = fileURLToPath(
  new URL("../public/operations.css", import.meta.url),
);
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).default("");
const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(200),
});
const requestSchema = z.object({
  propertyId: z.string().uuid(),
  title: text(160),
  category: text(100),
  description: text(5000),
  priority: z.enum(["Routine", "Soon", "Urgent"]),
  permissionToEnter: z.boolean().default(false),
  occupancyStatus: text(80),
  preferredServiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  preferredServiceWindow: optionalText(80),
  spendingLimit: z.number().min(0).max(1_000_000).nullable().optional(),
  accessInstructions: optionalText(3000),
  additionalNotes: optionalText(3000),
});
const statusSchema = z.enum(OPERATIONS_REQUEST_STATUSES);
const transitions: Record<OperationsRequestStatus, OperationsRequestStatus[]> =
  {
    submitted: ["owner_review", "declined", "cancelled"],
    owner_review: [
      "needs_information",
      "estimating",
      "dispatching",
      "scheduled",
      "declined",
      "closed",
    ],
    needs_information: ["owner_review", "cancelled"],
    estimating: ["awaiting_approval", "dispatching", "declined"],
    awaiting_approval: ["approved", "estimating", "declined"],
    approved: ["dispatching", "scheduled", "cancelled"],
    dispatching: ["offered_to_vendor", "assigned", "scheduled", "declined"],
    offered_to_vendor: ["dispatching", "assigned", "cancelled"],
    assigned: ["scheduled", "in_progress", "cancelled"],
    scheduled: ["in_progress", "cancelled"],
    in_progress: ["awaiting_completion_review", "cancelled"],
    awaiting_completion_review: ["completed", "in_progress"],
    completed: ["closed"],
    declined: ["closed"],
    cancelled: ["closed"],
    closed: [],
  };

type OperationsPrincipal =
  | {
      type: "organization_user";
      id: string;
      organizationId: string;
      role: "Property Manager" | "Property Staff";
      name: string;
      email: string;
    }
  | { type: "vendor"; id: string; name: string; email: string };
type OperationsRequest = express.Request & {
  operationsPrincipal?: OperationsPrincipal;
};
function cookie(header: string | undefined, name: string) {
  return header
    ?.split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
function routeParam(request: express.Request, name: string) {
  const value = request.params[name];
  return Array.isArray(value) ? value[0] || "" : value || "";
}
function cleanFileName(value: string | undefined) {
  return (value || "request-media")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .slice(0, 180);
}
function publicRequest(row: Record<string, unknown>) {
  const {
    internal_notes,
    assigned_vendor_id,
    assigned_technician_id,
    ...safe
  } = row;
  return safe;
}

function operationsAuth(
  db: Kysely<TaskCoreDatabase>,
  principalType: "organization_user" | "vendor",
): RequestHandler {
  return async (request: OperationsRequest, response, next) => {
    try {
      const token = cookie(
        request.get("cookie"),
        principalType === "vendor"
          ? "taskcore_vendor_session"
          : "taskcore_manager_session",
      );
      if (!token)
        return response.status(401).json({ error: "Sign-in is required." });
      const session = await db
        .selectFrom("operations_sessions")
        .selectAll()
        .where("token_hash", "=", hashToken(decodeURIComponent(token)))
        .where("principal_type", "=", principalType)
        .where("expires_at", ">", new Date().toISOString())
        .executeTakeFirst();
      if (!session)
        return response
          .status(401)
          .json({ error: "Your session has expired." });
      if (principalType === "organization_user") {
        const user = await db
          .selectFrom("organization_users")
          .selectAll()
          .where("id", "=", session.principal_id)
          .where("active", "=", 1)
          .executeTakeFirst();
        if (!user)
          return response
            .status(401)
            .json({ error: "Your account is unavailable." });
        request.operationsPrincipal = {
          type: "organization_user",
          id: user.id,
          organizationId: user.organization_id,
          role: user.role,
          name: user.name,
          email: user.email,
        };
      } else {
        const vendor = await db
          .selectFrom("vendors")
          .selectAll()
          .where("id", "=", session.principal_id)
          .where("active", "=", 1)
          .executeTakeFirst();
        if (!vendor)
          return response
            .status(401)
            .json({ error: "Your account is unavailable." });
        request.operationsPrincipal = {
          type: "vendor",
          id: vendor.id,
          name: vendor.business_name,
          email: vendor.email,
        };
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

async function nextRequestNumber(db: Kysely<TaskCoreDatabase>) {
  const rows = await db
    .selectFrom("operations_service_requests")
    .select("request_number")
    .execute();
  const maximum = rows.reduce(
    (max, row) =>
      Math.max(max, Number(row.request_number.match(/(\d+)$/)?.[1] || 1041)),
    1041,
  );
  return `TC-REQ-${maximum + 1}`;
}
async function history(
  db: Kysely<TaskCoreDatabase>,
  requestId: string,
  actorType: "Owner" | "Organization User" | "Technician" | "Vendor" | "System",
  actorId: string,
  action: string,
  fromStatus: string | null,
  toStatus: string | null,
  details: unknown = {},
  customerVisible = false,
) {
  await db
    .insertInto("operations_request_history")
    .values({
      id: randomUUID(),
      request_id: requestId,
      actor_type: actorType,
      actor_id: actorId,
      action,
      from_status: fromStatus,
      to_status: toStatus,
      details_json: JSON.stringify(details),
      customer_visible: customerVisible ? 1 : 0,
      created_at: new Date().toISOString(),
    })
    .execute();
}
async function scopedManagerRequest(
  db: Kysely<TaskCoreDatabase>,
  id: string,
  organizationId: string,
) {
  return db
    .selectFrom("operations_service_requests")
    .selectAll()
    .where("id", "=", id)
    .where("organization_id", "=", organizationId)
    .executeTakeFirst();
}

export function registerOperationsRoutes(
  app: express.Express,
  config: AppConfig,
  db: Kysely<TaskCoreDatabase>,
) {
  app.get("/operations.css", (_r, res, next) =>
    res.sendFile(sharedOperationsStyles, { dotfiles: "deny" }, (e) =>
      e ? next(e) : undefined,
    ),
  );
  app.get(["/manager", "/manager/"], (_r, res, next) =>
    res.sendFile(
      path.join(managerDirectory, "index.html"),
      { dotfiles: "deny" },
      (e) => (e ? next(e) : undefined),
    ),
  );
  app.use(
    "/manager",
    express.static(managerDirectory, { index: false, dotfiles: "deny" }),
  );
  app.get(["/contractor", "/contractor/"], (_r, res, next) =>
    res.sendFile(
      path.join(contractorDirectory, "index.html"),
      { dotfiles: "deny" },
      (e) => (e ? next(e) : undefined),
    ),
  );
  app.use(
    "/contractor",
    express.static(contractorDirectory, { index: false, dotfiles: "deny" }),
  );

  app.post("/api/manager/login", async (request, response, next) => {
    try {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success)
        return response
          .status(400)
          .json({ error: "Enter a valid email and password." });
      const user = await db
        .selectFrom("organization_users")
        .selectAll()
        .where("email", "=", parsed.data.email.toLowerCase())
        .where("active", "=", 1)
        .executeTakeFirst();
      if (!user || !verifyPassword(parsed.data.password, user.password_hash))
        return response
          .status(401)
          .json({ error: "Email or password is incorrect." });
      const token = createOpaqueToken(),
        now = new Date(),
        expires = new Date(now.getTime() + 12 * 3600000);
      await db
        .insertInto("operations_sessions")
        .values({
          id: randomUUID(),
          principal_type: "organization_user",
          principal_id: user.id,
          token_hash: hashToken(token),
          expires_at: expires.toISOString(),
          created_at: now.toISOString(),
        })
        .execute();
      response
        .cookie("taskcore_manager_session", token, {
          httpOnly: true,
          sameSite: "strict",
          secure: config.nodeEnv === "production",
          expires,
          path: "/",
        })
        .json({ user: { id: user.id, name: user.name, role: user.role } });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/contractor/login", async (request, response, next) => {
    try {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success)
        return response
          .status(400)
          .json({ error: "Enter a valid email and password." });
      const vendor = await db
        .selectFrom("vendors")
        .selectAll()
        .where("email", "=", parsed.data.email.toLowerCase())
        .where("active", "=", 1)
        .executeTakeFirst();
      if (
        !vendor ||
        !verifyPassword(parsed.data.password, vendor.password_hash)
      )
        return response
          .status(401)
          .json({ error: "Email or password is incorrect." });
      const token = createOpaqueToken(),
        now = new Date(),
        expires = new Date(now.getTime() + 12 * 3600000);
      await db
        .insertInto("operations_sessions")
        .values({
          id: randomUUID(),
          principal_type: "vendor",
          principal_id: vendor.id,
          token_hash: hashToken(token),
          expires_at: expires.toISOString(),
          created_at: now.toISOString(),
        })
        .execute();
      response
        .cookie("taskcore_vendor_session", token, {
          httpOnly: true,
          sameSite: "strict",
          secure: config.nodeEnv === "production",
          expires,
          path: "/",
        })
        .json({ vendor: { id: vendor.id, name: vendor.business_name } });
    } catch (error) {
      next(error);
    }
  });

  const managerAuth = operationsAuth(db, "organization_user"),
    vendorAuth = operationsAuth(db, "vendor");
  app.use("/api/manager", managerAuth);
  app.use("/api/contractor", vendorAuth);
  app.get("/api/manager/session", (req: OperationsRequest, res) =>
    res.json({ user: req.operationsPrincipal }),
  );
  app.get(
    "/api/manager/dashboard",
    async (req: OperationsRequest, res, next) => {
      try {
        const p = req.operationsPrincipal! as Extract<
          OperationsPrincipal,
          { type: "organization_user" }
        >;
        const organization = await db
          .selectFrom("organizations")
          .select(["id", "name"])
          .where("id", "=", p.organizationId)
          .executeTakeFirstOrThrow();
        const org = await db
          .selectFrom("organizations")
          .select("client_id")
          .where("id", "=", p.organizationId)
          .executeTakeFirstOrThrow();
        const properties = await db
          .selectFrom("properties")
          .select(["id", "name", "address"])
          .where("client_id", "=", org.client_id)
          .where("active", "=", 1)
          .execute();
        const requests = await db
          .selectFrom("operations_service_requests")
          .selectAll()
          .where("organization_id", "=", p.organizationId)
          .orderBy("updated_at", "desc")
          .execute();
        const counts = {
          totalProperties: properties.length,
          openRequests: requests.filter(
            (r) =>
              !["completed", "declined", "cancelled", "closed"].includes(
                r.status,
              ),
          ).length,
          awaitingApproval: requests.filter(
            (r) => r.status === "awaiting_approval",
          ).length,
          scheduled: requests.filter((r) => r.status === "scheduled").length,
          inProgress: requests.filter((r) => r.status === "in_progress").length,
          recentlyCompleted: requests.filter((r) =>
            ["completed", "closed"].includes(r.status),
          ).length,
        };
        res.json({
          organization,
          user: p,
          counts,
          properties,
          requests: requests.map((r) =>
            publicRequest(r as unknown as Record<string, unknown>),
          ),
        });
      } catch (e) {
        next(e);
      }
    },
  );
  app.get(
    "/api/manager/properties/:id/history",
    async (req: OperationsRequest, res, next) => {
      try {
        const p = req.operationsPrincipal! as Extract<
          OperationsPrincipal,
          { type: "organization_user" }
        >;
        const org = await db
          .selectFrom("organizations")
          .select("client_id")
          .where("id", "=", p.organizationId)
          .executeTakeFirstOrThrow();
        const property = await db
          .selectFrom("properties")
          .selectAll()
          .where("id", "=", routeParam(req, "id"))
          .where("client_id", "=", org.client_id)
          .executeTakeFirst();
        if (!property)
          return res.status(404).json({ error: "Property not found." });
        const activity = await db
          .selectFrom("property_activity")
          .selectAll()
          .where("property_id", "=", property.id)
          .where("visibility", "=", "Customer")
          .orderBy("created_at", "desc")
          .execute();
        const inspections = await db
          .selectFrom("inspections")
          .select([
            "id",
            "inspection_type",
            "status",
            "created_at",
            "published_at",
          ])
          .where("property_id", "=", property.id)
          .where("status", "=", "Published")
          .execute();
        res.json({ property, activity, inspections });
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    "/api/manager/requests",
    async (req: OperationsRequest, res, next) => {
      try {
        const parsed = requestSchema.safeParse(req.body);
        if (!parsed.success)
          return res
            .status(400)
            .json({
              error: "Check the service request details.",
              fields: parsed.error.flatten().fieldErrors,
            });
        const p = req.operationsPrincipal! as Extract<
          OperationsPrincipal,
          { type: "organization_user" }
        >;
        const org = await db
          .selectFrom("organizations")
          .select("client_id")
          .where("id", "=", p.organizationId)
          .executeTakeFirstOrThrow();
        const property = await db
          .selectFrom("properties")
          .select("id")
          .where("id", "=", parsed.data.propertyId)
          .where("client_id", "=", org.client_id)
          .where("active", "=", 1)
          .executeTakeFirst();
        if (!property)
          return res.status(404).json({ error: "Property not found." });
        const id = randomUUID(),
          number = await nextRequestNumber(db),
          now = new Date().toISOString();
        await db.transaction().execute(async (tx) => {
          await tx
            .insertInto("operations_service_requests")
            .values({
              id,
              request_number: number,
              organization_id: p.organizationId,
              property_id: property.id,
              created_by_user_id: p.id,
              inspection_id: null,
              finding_id: null,
              title: parsed.data.title,
              category: parsed.data.category,
              description: parsed.data.description,
              priority: parsed.data.priority,
              status: "submitted",
              permission_to_enter: parsed.data.permissionToEnter ? 1 : 0,
              occupancy_status: parsed.data.occupancyStatus,
              preferred_service_date: parsed.data.preferredServiceDate || null,
              preferred_service_window: parsed.data.preferredServiceWindow,
              spending_limit_cents:
                parsed.data.spendingLimit == null
                  ? null
                  : Math.round(parsed.data.spendingLimit * 100),
              access_instructions: parsed.data.accessInstructions,
              customer_notes: parsed.data.additionalNotes,
              internal_notes: "",
              channel_id: null,
              assigned_technician_id: null,
              assigned_vendor_id: null,
              scheduled_at: null,
              created_at: now,
              updated_at: now,
            })
            .execute();
          await tx
            .insertInto("operations_request_history")
            .values({
              id: randomUUID(),
              request_id: id,
              actor_type: "Organization User",
              actor_id: p.id,
              action: "Request submitted",
              from_status: null,
              to_status: "submitted",
              details_json: "{}",
              customer_visible: 1,
              created_at: now,
            })
            .execute();
          await tx
            .insertInto("property_activity")
            .values({
              id: randomUUID(),
              property_id: property.id,
              request_id: id,
              inspection_id: null,
              event_type: "Service request",
              summary: `${number} submitted`,
              visibility: "Customer",
              created_at: now,
            })
            .execute();
          await tx
            .insertInto("operations_notifications")
            .values({
              id: randomUUID(),
              organization_id: null,
              organization_user_id: null,
              vendor_id: null,
              request_id: id,
              event_type: "New Property Manager request",
              message: `${number} requires owner review.`,
              read_at: null,
              created_at: now,
            })
            .execute();
        });
        res
          .status(201)
          .json({ id, requestNumber: number, status: "submitted" });
      } catch (e) {
        next(e);
      }
    },
  );
  app.get(
    "/api/manager/requests/:id",
    async (req: OperationsRequest, res, next) => {
      try {
        const p = req.operationsPrincipal! as Extract<
            OperationsPrincipal,
            { type: "organization_user" }
          >,
          row = await scopedManagerRequest(
            db,
            routeParam(req, "id"),
            p.organizationId,
          );
        if (!row) return res.status(404).json({ error: "Request not found." });
        const [media, comments, historyRows, estimate] = await Promise.all([
          db
            .selectFrom("operations_request_media")
            .select([
              "id",
              "kind",
              "file_name",
              "mime_type",
              "size_bytes",
              "created_at",
            ])
            .where("request_id", "=", row.id)
            .where("visibility", "=", "Customer")
            .execute(),
          db
            .selectFrom("operations_comments")
            .selectAll()
            .where("request_id", "=", row.id)
            .where("visibility", "=", "Customer")
            .execute(),
          db
            .selectFrom("operations_request_history")
            .select(["action", "from_status", "to_status", "created_at"])
            .where("request_id", "=", row.id)
            .where("customer_visible", "=", 1)
            .execute(),
          db
            .selectFrom("estimates")
            .leftJoin("estimate_revisions", (j) =>
              j
                .onRef("estimate_revisions.estimate_id", "=", "estimates.id")
                .onRef(
                  "estimate_revisions.revision_number",
                  "=",
                  "estimates.current_revision",
                ),
            )
            .select([
              "estimates.id",
              "estimates.status",
              "estimates.current_revision",
              "estimate_revisions.amount_cents",
              "estimate_revisions.scope",
              "estimate_revisions.customer_note",
            ])
            .where("estimates.request_id", "=", row.id)
            .executeTakeFirst(),
        ]);
        res.json({
          request: publicRequest(row as unknown as Record<string, unknown>),
          media,
          comments,
          history: historyRows,
          estimate,
        });
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    "/api/manager/requests/:id/comments",
    async (req: OperationsRequest, res, next) => {
      try {
        const body = text(3000).safeParse(req.body?.body),
          p = req.operationsPrincipal! as Extract<
            OperationsPrincipal,
            { type: "organization_user" }
          >;
        if (!body.success)
          return res.status(400).json({ error: "Enter a comment." });
        const row = await scopedManagerRequest(
          db,
          routeParam(req, "id"),
          p.organizationId,
        );
        if (!row) return res.status(404).json({ error: "Request not found." });
        const now = new Date().toISOString();
        await db
          .insertInto("operations_comments")
          .values({
            id: randomUUID(),
            request_id: row.id,
            actor_type: "Organization User",
            actor_id: p.id,
            body: body.data,
            visibility: "Customer",
            created_at: now,
          })
          .execute();
        await db
          .insertInto("operations_notifications")
          .values({
            id: randomUUID(),
            organization_id: null,
            organization_user_id: null,
            vendor_id: null,
            request_id: row.id,
            event_type: "Property Manager comment",
            message: `${row.request_number} received a customer comment.`,
            read_at: null,
            created_at: now,
          })
          .execute();
        res.status(201).json({ createdAt: now });
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    "/api/manager/estimates/:id/decision",
    async (req: OperationsRequest, res, next) => {
      try {
        const parsed = z
            .object({
              decision: z.enum(["Approved", "Declined", "Changes Requested"]),
              comment: optionalText(2000),
            })
            .safeParse(req.body),
          p = req.operationsPrincipal! as Extract<
            OperationsPrincipal,
            { type: "organization_user" }
          >;
        if (!parsed.success)
          return res
            .status(400)
            .json({ error: "Choose an estimate decision." });
        const estimate = await db
          .selectFrom("estimates")
          .innerJoin(
            "operations_service_requests",
            "operations_service_requests.id",
            "estimates.request_id",
          )
          .select([
            "estimates.id",
            "estimates.request_id",
            "estimates.status",
            "operations_service_requests.organization_id",
            "operations_service_requests.status as request_status",
          ])
          .where("estimates.id", "=", routeParam(req, "id"))
          .where(
            "operations_service_requests.organization_id",
            "=",
            p.organizationId,
          )
          .executeTakeFirst();
        if (!estimate)
          return res.status(404).json({ error: "Estimate not found." });
        if (estimate.status !== "Awaiting Approval")
          return res
            .status(409)
            .json({ error: "This estimate is not awaiting approval." });
        const now = new Date().toISOString(),
          requestStatus =
            parsed.data.decision === "Approved"
              ? "approved"
              : parsed.data.decision === "Declined"
                ? "declined"
                : "estimating";
        await db.transaction().execute(async (tx) => {
          await tx
            .insertInto("estimate_approvals")
            .values({
              id: randomUUID(),
              estimate_id: estimate.id,
              organization_user_id: p.id,
              decision: parsed.data.decision,
              comment: parsed.data.comment,
              created_at: now,
            })
            .execute();
          await tx
            .updateTable("estimates")
            .set({ status: parsed.data.decision, updated_at: now })
            .where("id", "=", estimate.id)
            .execute();
          await tx
            .updateTable("operations_service_requests")
            .set({ status: requestStatus, updated_at: now })
            .where("id", "=", estimate.request_id)
            .execute();
        });
        await history(
          db,
          estimate.request_id,
          "Organization User",
          p.id,
          `Estimate ${parsed.data.decision.toLowerCase()}`,
          estimate.request_status,
          requestStatus,
          { comment: parsed.data.comment },
          true,
        );
        res.json({ status: parsed.data.decision });
      } catch (e) {
        next(e);
      }
    },
  );

  app.post(
    "/api/manager/requests/:id/media",
    async (req: OperationsRequest, res, next) =>
      uploadRequestMedia(req, res, next, db, config, "manager"),
  );
  app.get(
    "/api/manager/requests/:requestId/media/:mediaId",
    async (req: OperationsRequest, res, next) =>
      sendScopedMedia(req, res, next, db, config, "manager"),
  );

  app.get("/api/contractor/session", (req: OperationsRequest, res) =>
    res.json({ vendor: req.operationsPrincipal }),
  );
  app.get(
    "/api/contractor/offers",
    async (req: OperationsRequest, res, next) => {
      try {
        const p = req.operationsPrincipal! as Extract<
          OperationsPrincipal,
          { type: "vendor" }
        >;
        const rows = await db
          .selectFrom("contractor_offers")
          .innerJoin(
            "operations_service_requests",
            "operations_service_requests.id",
            "contractor_offers.request_id",
          )
          .innerJoin(
            "properties",
            "properties.id",
            "operations_service_requests.property_id",
          )
          .select([
            "contractor_offers.id",
            "contractor_offers.request_id",
            "contractor_offers.scope",
            "contractor_offers.offered_compensation_cents",
            "contractor_offers.service_window",
            "contractor_offers.status",
            "contractor_offers.created_at",
            "operations_service_requests.request_number",
            "operations_service_requests.category",
            "operations_service_requests.description",
            "operations_service_requests.access_instructions",
            "operations_service_requests.occupancy_status",
            "properties.name as property_name",
            "properties.address",
          ])
          .where("contractor_offers.vendor_id", "=", p.id)
          .orderBy("contractor_offers.created_at", "desc")
          .execute();
        res.json({ offers: rows });
      } catch (e) {
        next(e);
      }
    },
  );
  app.get(
    "/api/contractor/requests/:id",
    async (req: OperationsRequest, res, next) => {
      try {
        const p = req.operationsPrincipal! as Extract<OperationsPrincipal, { type: "vendor" }>;
        const row = await db
          .selectFrom("contractor_offers")
          .innerJoin("operations_service_requests", "operations_service_requests.id", "contractor_offers.request_id")
          .innerJoin("properties", "properties.id", "operations_service_requests.property_id")
          .select(["operations_service_requests.id", "operations_service_requests.request_number", "operations_service_requests.title", "operations_service_requests.category", "operations_service_requests.description", "operations_service_requests.priority", "operations_service_requests.permission_to_enter", "operations_service_requests.occupancy_status", "operations_service_requests.preferred_service_date", "operations_service_requests.preferred_service_window", "operations_service_requests.access_instructions", "operations_service_requests.status", "properties.name as property_name", "properties.address", "contractor_offers.scope", "contractor_offers.offered_compensation_cents", "contractor_offers.service_window", "contractor_offers.status as offer_status"])
          .where("operations_service_requests.id", "=", routeParam(req, "id"))
          .where("contractor_offers.vendor_id", "=", p.id)
          .where("contractor_offers.status", "in", ["Offered", "Accepted"])
          .executeTakeFirst();
        if (!row) return res.status(404).json({ error: "Job not found." });
        const media = await db.selectFrom("operations_request_media").select(["id", "kind", "file_name", "mime_type", "size_bytes"]).where("request_id", "=", row.id).where("visibility", "in", ["Customer", "Contractor"]).execute();
        res.json({ job: row, media });
      } catch (e) { next(e); }
    },
  );
  app.post(
    "/api/contractor/offers/:id/respond",
    async (req: OperationsRequest, res, next) => {
      try {
        const parsed = z
            .object({ decision: z.enum(["Accepted", "Declined"]) })
            .safeParse(req.body),
          p = req.operationsPrincipal! as Extract<
            OperationsPrincipal,
            { type: "vendor" }
          >;
        if (!parsed.success)
          return res.status(400).json({ error: "Choose accept or decline." });
        const offer = await db
          .selectFrom("contractor_offers")
          .selectAll()
          .where("id", "=", routeParam(req, "id"))
          .where("vendor_id", "=", p.id)
          .executeTakeFirst();
        if (!offer) return res.status(404).json({ error: "Offer not found." });
        if (offer.status !== "Offered")
          return res
            .status(409)
            .json({ error: "This offer has already been answered." });
        const now = new Date().toISOString(),
          nextStatus =
            parsed.data.decision === "Accepted" ? "assigned" : "dispatching";
        await db.transaction().execute(async (tx) => {
          await tx
            .updateTable("contractor_offers")
            .set({
              status: parsed.data.decision,
              responded_at: now,
              updated_at: now,
            })
            .where("id", "=", offer.id)
            .execute();
          await tx
            .updateTable("operations_service_requests")
            .set({
              status: nextStatus,
              assigned_vendor_id:
                parsed.data.decision === "Accepted" ? p.id : null,
              updated_at: now,
            })
            .where("id", "=", offer.request_id)
            .execute();
          await tx
            .insertInto("operations_notifications")
            .values({
              id: randomUUID(),
              organization_id: null,
              organization_user_id: null,
              vendor_id: null,
              request_id: offer.request_id,
              event_type: `Contractor ${parsed.data.decision.toLowerCase()}`,
              message: `${p.name} ${parsed.data.decision.toLowerCase()} a job offer.`,
              read_at: null,
              created_at: now,
            })
            .execute();
        });
        await history(
          db,
          offer.request_id,
          "Vendor",
          p.id,
          `Offer ${parsed.data.decision.toLowerCase()}`,
          "offered_to_vendor",
          nextStatus,
          {},
          false,
        );
        res.json({ status: parsed.data.decision });
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    "/api/contractor/requests/:id/completion",
    async (req: OperationsRequest, res, next) => {
      try {
        const parsed = z
            .object({
              completionNotes: text(5000),
              materialsNotes: optionalText(3000),
              invoiceAmount: z
                .number()
                .min(0)
                .max(1_000_000)
                .nullable()
                .optional(),
            })
            .safeParse(req.body),
          p = req.operationsPrincipal! as Extract<
            OperationsPrincipal,
            { type: "vendor" }
          >;
        if (!parsed.success)
          return res.status(400).json({ error: "Enter completion notes." });
        const row = await db
          .selectFrom("operations_service_requests")
          .selectAll()
          .where("id", "=", routeParam(req, "id"))
          .where("assigned_vendor_id", "=", p.id)
          .where("status", "in", ["assigned", "scheduled", "in_progress"])
          .executeTakeFirst();
        if (!row)
          return res.status(404).json({ error: "Assigned job not found." });
        const id = randomUUID(),
          now = new Date().toISOString();
        await db.transaction().execute(async (tx) => {
          await tx
            .insertInto("job_completion_reports")
            .values({
              id,
              request_id: row.id,
              vendor_id: p.id,
              technician_id: null,
              completion_notes: parsed.data.completionNotes,
              materials_notes: parsed.data.materialsNotes,
              invoice_amount_cents:
                parsed.data.invoiceAmount == null
                  ? null
                  : Math.round(parsed.data.invoiceAmount * 100),
              status: "Submitted",
              reviewed_at: null,
              created_at: now,
              updated_at: now,
            })
            .execute();
          await tx
            .updateTable("operations_service_requests")
            .set({ status: "awaiting_completion_review", updated_at: now })
            .where("id", "=", row.id)
            .execute();
          await tx
            .insertInto("operations_notifications")
            .values({
              id: randomUUID(),
              organization_id: null,
              organization_user_id: null,
              vendor_id: null,
              request_id: row.id,
              event_type: "Completion awaiting owner review",
              message: `${row.request_number} completion requires owner review.`,
              read_at: null,
              created_at: now,
            })
            .execute();
        });
        await history(
          db,
          row.id,
          "Vendor",
          p.id,
          "Completion submitted",
          row.status,
          "awaiting_completion_review",
          {},
          false,
        );
        res.status(201).json({ id, status: "Submitted" });
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    "/api/contractor/requests/:id/media",
    async (req: OperationsRequest, res, next) =>
      uploadRequestMedia(req, res, next, db, config, "vendor"),
  );
  app.get(
    "/api/contractor/requests/:requestId/media/:mediaId",
    async (req: OperationsRequest, res, next) =>
      sendScopedMedia(req, res, next, db, config, "vendor"),
  );

  registerAdminOperations(app, config, db);
  const techAuth = createTechnicianAuth(db, config);
  app.get(
    "/api/tech/jobs",
    techAuth,
    async (req: TechnicianRequest, res, next) => {
      try {
        const jobs = await db
          .selectFrom("operations_service_requests")
          .innerJoin(
            "properties",
            "properties.id",
            "operations_service_requests.property_id",
          )
          .select([
            "operations_service_requests.id",
            "operations_service_requests.request_number",
            "operations_service_requests.title",
            "operations_service_requests.category",
            "operations_service_requests.description",
            "operations_service_requests.priority",
            "operations_service_requests.status",
            "operations_service_requests.scheduled_at",
            "properties.name as property_name",
            "properties.address",
          ])
          .where("assigned_technician_id", "=", req.technician!.id)
          .execute();
        res.json({ jobs });
      } catch (e) {
        next(e);
      }
    },
  );
}

function registerAdminOperations(
  app: express.Express,
  config: AppConfig,
  db: Kysely<TaskCoreDatabase>,
) {
  app.get("/api/admin/operations/setup", async (_req, res, next) => {
    try {
      const [organizations, users, vendors, channels, technicians] =
        await Promise.all([
          db.selectFrom("organizations").selectAll().execute(),
          db
            .selectFrom("organization_users")
            .select([
              "id",
              "organization_id",
              "role",
              "name",
              "email",
              "active",
              "created_at",
            ])
            .execute(),
          db
            .selectFrom("vendors")
            .select([
              "id",
              "business_name",
              "contact_name",
              "email",
              "phone",
              "status",
              "active",
              "w9_status",
              "insurance_status",
              "license_status",
              "license_number",
              "license_type",
              "license_expires_at",
              "insurance_expires_at",
              "internal_notes",
              "created_at",
              "updated_at",
            ])
            .execute(),
          db.selectFrom("work_channels").selectAll().execute(),
          db
            .selectFrom("technicians")
            .select(["id", "name", "email", "active"])
            .execute(),
        ]);
      res.json({ organizations, users, vendors, channels, technicians });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/admin/operations/organizations", async (req, res, next) => {
    try {
      const parsed = z
        .object({
          name: text(140),
          contactName: text(100),
          email: z.string().email(),
          phone: z.string().trim().max(30).optional(),
          managerName: text(100),
          managerEmail: z.string().email(),
          managerPassword: z.string().min(10).max(200),
        })
        .safeParse(req.body);
      if (!parsed.success)
        return res
          .status(400)
          .json({ error: "Check the organization and manager details." });
      const now = new Date().toISOString(),
        clientId = randomUUID(),
        id = randomUUID(),
        userId = randomUUID();
      await db.transaction().execute(async (tx) => {
        await tx
          .insertInto("clients")
          .values({
            id: clientId,
            company_name: parsed.data.name,
            contact_name: parsed.data.contactName,
            email: parsed.data.email.toLowerCase(),
            phone: parsed.data.phone || null,
            created_at: now,
          })
          .execute();
        await tx
          .insertInto("organizations")
          .values({
            id,
            client_id: clientId,
            name: parsed.data.name,
            created_at: now,
            updated_at: now,
          })
          .execute();
        await tx
          .insertInto("organization_users")
          .values({
            id: userId,
            organization_id: id,
            role: "Property Manager",
            name: parsed.data.managerName,
            email: parsed.data.managerEmail.toLowerCase(),
            password_hash: hashPassword(parsed.data.managerPassword),
            created_at: now,
            updated_at: now,
          })
          .execute();
      });
      res.status(201).json({ id, clientId, managerUserId: userId });
    } catch (e) {
      next(e);
    }
  });
  app.post(
    "/api/admin/operations/organizations/:id/users",
    async (req, res, next) => {
      try {
        const parsed = z
          .object({
            role: z.enum(["Property Manager", "Property Staff"]),
            name: text(100),
            email: z.string().email(),
            password: z.string().min(10).max(200),
          })
          .safeParse(req.body);
        if (!parsed.success)
          return res
            .status(400)
            .json({ error: "Check the organization user." });
        const org = await db
          .selectFrom("organizations")
          .select("id")
          .where("id", "=", routeParam(req, "id"))
          .executeTakeFirst();
        if (!org)
          return res.status(404).json({ error: "Organization not found." });
        const id = randomUUID(),
          now = new Date().toISOString();
        await db
          .insertInto("organization_users")
          .values({
            id,
            organization_id: org.id,
            role: parsed.data.role,
            name: parsed.data.name,
            email: parsed.data.email.toLowerCase(),
            password_hash: hashPassword(parsed.data.password),
            created_at: now,
            updated_at: now,
          })
          .execute();
        res.status(201).json({ id });
      } catch (e) {
        next(e);
      }
    },
  );
  app.post("/api/admin/operations/vendors", async (req, res, next) => {
    try {
      const parsed = z
        .object({
          businessName: text(140),
          contactName: text(100),
          email: z.string().email(),
          phone: z.string().trim().max(30).optional(),
          password: z.string().min(10).max(200),
          channelIds: z.array(z.string()).default([]),
          w9Status: optionalText(30),
          insuranceStatus: optionalText(30),
          licenseStatus: optionalText(30),
          licenseNumber: optionalText(80),
          licenseType: optionalText(100),
          licenseExpiresAt: z.string().nullable().optional(),
          insuranceExpiresAt: z.string().nullable().optional(),
          internalNotes: optionalText(3000),
        })
        .safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ error: "Check the vendor details." });
      const id = randomUUID(),
        now = new Date().toISOString();
      await db.transaction().execute(async (tx) => {
        await tx
          .insertInto("vendors")
          .values({
            id,
            business_name: parsed.data.businessName,
            contact_name: parsed.data.contactName,
            email: parsed.data.email.toLowerCase(),
            phone: parsed.data.phone || null,
            password_hash: hashPassword(parsed.data.password),
            status: "Approved",
            w9_status: parsed.data.w9Status || "Not reviewed",
            insurance_status: parsed.data.insuranceStatus || "Not reviewed",
            license_status: parsed.data.licenseStatus || "Not reviewed",
            license_number: parsed.data.licenseNumber,
            license_type: parsed.data.licenseType,
            license_expires_at: parsed.data.licenseExpiresAt || null,
            insurance_expires_at: parsed.data.insuranceExpiresAt || null,
            internal_notes: parsed.data.internalNotes,
            created_at: now,
            updated_at: now,
          })
          .execute();
        for (const channelId of parsed.data.channelIds)
          await tx
            .insertInto("vendor_channels")
            .values({ vendor_id: id, channel_id: channelId })
            .execute();
      });
      res.status(201).json({ id });
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/admin/operations/requests", async (_req, res, next) => {
    try {
      const rows = await db
        .selectFrom("operations_service_requests")
        .innerJoin(
          "organizations",
          "organizations.id",
          "operations_service_requests.organization_id",
        )
        .innerJoin(
          "properties",
          "properties.id",
          "operations_service_requests.property_id",
        )
        .selectAll("operations_service_requests")
        .select([
          "organizations.name as organization_name",
          "properties.name as property_name",
          "properties.address",
        ])
        .orderBy("operations_service_requests.updated_at", "desc")
        .execute();
      res.json({ requests: rows });
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/admin/operations/requests/:id", async (req, res, next) => {
    try {
      const row = await db
        .selectFrom("operations_service_requests")
        .selectAll()
        .where("id", "=", routeParam(req, "id"))
        .executeTakeFirst();
      if (!row) return res.status(404).json({ error: "Request not found." });
      const [
        historyRows,
        comments,
        media,
        estimates,
        offers,
        completions,
        activity,
      ] = await Promise.all([
        db
          .selectFrom("operations_request_history")
          .selectAll()
          .where("request_id", "=", row.id)
          .orderBy("created_at")
          .execute(),
        db
          .selectFrom("operations_comments")
          .selectAll()
          .where("request_id", "=", row.id)
          .execute(),
        db
          .selectFrom("operations_request_media")
          .selectAll()
          .where("request_id", "=", row.id)
          .execute(),
        db
          .selectFrom("estimates")
          .selectAll()
          .where("request_id", "=", row.id)
          .execute(),
        db
          .selectFrom("contractor_offers")
          .selectAll()
          .where("request_id", "=", row.id)
          .execute(),
        db
          .selectFrom("job_completion_reports")
          .selectAll()
          .where("request_id", "=", row.id)
          .execute(),
        db
          .selectFrom("property_activity")
          .selectAll()
          .where("property_id", "=", row.property_id)
          .orderBy("created_at", "desc")
          .execute(),
      ]);
      res.json({
        request: row,
        history: historyRows,
        comments,
        media,
        estimates,
        offers,
        completions,
        propertyHistory: activity,
      });
    } catch (e) {
      next(e);
    }
  });
  app.patch(
    "/api/admin/operations/requests/:id/dispatch",
    async (req, res, next) => {
      try {
        const parsed = z
          .object({
            status: statusSchema.optional(),
            category: z.string().trim().max(100).optional(),
            priority: z.enum(["Routine", "Soon", "Urgent"]).optional(),
            internalNotes: z.string().trim().max(5000).optional(),
            channelId: z.string().nullable().optional(),
            technicianId: z.string().uuid().nullable().optional(),
            scheduledAt: z.string().nullable().optional(),
            customerNote: z.string().trim().max(3000).optional(),
          })
          .safeParse(req.body);
        if (!parsed.success)
          return res.status(400).json({ error: "Check the dispatch update." });
        const row = await db
          .selectFrom("operations_service_requests")
          .selectAll()
          .where("id", "=", routeParam(req, "id"))
          .executeTakeFirst();
        if (!row) return res.status(404).json({ error: "Request not found." });
        if (
          parsed.data.status &&
          !transitions[row.status].includes(parsed.data.status)
        )
          return res
            .status(409)
            .json({
              error: `Cannot move ${row.status} to ${parsed.data.status}.`,
            });
        const now = new Date().toISOString(),
          changes: Partial<typeof row> = { updated_at: now };
        if (parsed.data.status) changes.status = parsed.data.status;
        if (parsed.data.category) changes.category = parsed.data.category;
        if (parsed.data.priority) changes.priority = parsed.data.priority;
        if (parsed.data.internalNotes !== undefined)
          changes.internal_notes = parsed.data.internalNotes;
        if (parsed.data.channelId !== undefined)
          changes.channel_id = parsed.data.channelId;
        if (parsed.data.technicianId !== undefined)
          changes.assigned_technician_id = parsed.data.technicianId;
        if (parsed.data.scheduledAt !== undefined)
          changes.scheduled_at = parsed.data.scheduledAt;
        await db
          .updateTable("operations_service_requests")
          .set(changes)
          .where("id", "=", row.id)
          .execute();
        if (parsed.data.customerNote)
          await db
            .insertInto("operations_comments")
            .values({
              id: randomUUID(),
              request_id: row.id,
              actor_type: "Owner",
              actor_id: config.adminUsername,
              body: parsed.data.customerNote,
              visibility: "Customer",
              created_at: now,
            })
            .execute();
        await history(
          db,
          row.id,
          "Owner",
          config.adminUsername,
          "Dispatch updated",
          row.status,
          parsed.data.status || row.status,
          parsed.data,
          Boolean(parsed.data.customerNote || parsed.data.status),
        );
        res.json({ id: row.id, status: parsed.data.status || row.status });
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    "/api/admin/operations/requests/:id/estimate",
    async (req, res, next) => {
      try {
        const parsed = z
          .object({
            amount: z.number().min(0).max(1_000_000),
            scope: text(5000),
            customerNote: optionalText(3000),
          })
          .safeParse(req.body);
        if (!parsed.success)
          return res.status(400).json({ error: "Check the estimate." });
        const row = await db
          .selectFrom("operations_service_requests")
          .selectAll()
          .where("id", "=", routeParam(req, "id"))
          .executeTakeFirst();
        if (!row) return res.status(404).json({ error: "Request not found." });
        const existing = await db
            .selectFrom("estimates")
            .selectAll()
            .where("request_id", "=", row.id)
            .executeTakeFirst(),
          now = new Date().toISOString(),
          id = existing?.id || randomUUID(),
          revision = (existing?.current_revision || 0) + 1;
        await db.transaction().execute(async (tx) => {
          if (existing)
            await tx
              .updateTable("estimates")
              .set({
                status: "Awaiting Approval",
                current_revision: revision,
                updated_at: now,
              })
              .where("id", "=", id)
              .execute();
          else
            await tx
              .insertInto("estimates")
              .values({
                id,
                request_id: row.id,
                status: "Awaiting Approval",
                current_revision: revision,
                created_at: now,
                updated_at: now,
              })
              .execute();
          await tx
            .insertInto("estimate_revisions")
            .values({
              id: randomUUID(),
              estimate_id: id,
              revision_number: revision,
              amount_cents: Math.round(parsed.data.amount * 100),
              scope: parsed.data.scope,
              customer_note: parsed.data.customerNote,
              created_by: config.adminUsername,
              created_at: now,
            })
            .execute();
          await tx
            .updateTable("operations_service_requests")
            .set({ status: "awaiting_approval", updated_at: now })
            .where("id", "=", row.id)
            .execute();
          await tx
            .insertInto("operations_notifications")
            .values({
              id: randomUUID(),
              organization_id: row.organization_id,
              organization_user_id: null,
              vendor_id: null,
              request_id: row.id,
              event_type: "Estimate awaiting approval",
              message: `${row.request_number} has an estimate ready for review.`,
              read_at: null,
              created_at: now,
            })
            .execute();
        });
        await history(
          db,
          row.id,
          "Owner",
          config.adminUsername,
          "Estimate created",
          row.status,
          "awaiting_approval",
          { estimateId: id, revision },
          true,
        );
        res.status(201).json({ id, revision });
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    "/api/admin/operations/requests/:id/offers",
    async (req, res, next) => {
      try {
        const parsed = z
          .object({
            vendorId: z.string().uuid(),
            scope: text(5000),
            offeredCompensation: z.number().min(0).max(1_000_000),
            serviceWindow: text(100),
          })
          .safeParse(req.body);
        if (!parsed.success)
          return res.status(400).json({ error: "Check the contractor offer." });
        const [row, vendor] = await Promise.all([
          db
            .selectFrom("operations_service_requests")
            .selectAll()
            .where("id", "=", routeParam(req, "id"))
            .executeTakeFirst(),
          db
            .selectFrom("vendors")
            .selectAll()
            .where("id", "=", parsed.data.vendorId)
            .where("active", "=", 1)
            .executeTakeFirst(),
        ]);
        if (!row || !vendor)
          return res
            .status(404)
            .json({ error: "Request or vendor not found." });
        if (
          ![
            "owner_review",
            "approved",
            "dispatching",
            "offered_to_vendor",
          ].includes(row.status)
        )
          return res
            .status(409)
            .json({
              error: "This request is not ready for contractor dispatch.",
            });
        const id = randomUUID(),
          now = new Date().toISOString();
        await db.transaction().execute(async (tx) => {
          await tx
            .insertInto("contractor_offers")
            .values({
              id,
              request_id: row.id,
              vendor_id: vendor.id,
              scope: parsed.data.scope,
              offered_compensation_cents: Math.round(
                parsed.data.offeredCompensation * 100,
              ),
              service_window: parsed.data.serviceWindow,
              status: "Offered",
              responded_at: null,
              created_at: now,
              updated_at: now,
            })
            .execute();
          await tx
            .updateTable("operations_service_requests")
            .set({ status: "offered_to_vendor", updated_at: now })
            .where("id", "=", row.id)
            .execute();
          await tx
            .insertInto("operations_notifications")
            .values({
              id: randomUUID(),
              organization_id: null,
              organization_user_id: null,
              vendor_id: vendor.id,
              request_id: row.id,
              event_type: "Contractor offer",
              message: `New offer for ${row.request_number}.`,
              read_at: null,
              created_at: now,
            })
            .execute();
        });
        await history(
          db,
          row.id,
          "Owner",
          config.adminUsername,
          "Offered to contractor",
          row.status,
          "offered_to_vendor",
          { offerId: id, vendorId: vendor.id },
          false,
        );
        res
          .status(201)
          .json({
            id,
            complianceWarning:
              vendor.insurance_status !== "Verified" ||
              vendor.license_status === "Review required"
                ? "Review vendor license and insurance status before assignment."
                : null,
          });
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    "/api/admin/operations/completions/:id/review",
    async (req, res, next) => {
      try {
      const parsed = z
        .object({
          decision: z.enum(["Approved", "Changes Requested"]),
          customerNote: optionalText(3000),
          publishMediaIds: z.array(z.string().uuid()).default([]),
          })
          .safeParse(req.body);
        if (!parsed.success)
          return res
            .status(400)
            .json({ error: "Choose a completion decision." });
        const completion = await db
          .selectFrom("job_completion_reports")
          .innerJoin(
            "operations_service_requests",
            "operations_service_requests.id",
            "job_completion_reports.request_id",
          )
          .selectAll("job_completion_reports")
          .select([
            "operations_service_requests.status as request_status",
            "operations_service_requests.property_id",
            "operations_service_requests.request_number",
            "operations_service_requests.organization_id",
          ])
          .where("job_completion_reports.id", "=", routeParam(req, "id"))
          .executeTakeFirst();
        if (!completion)
          return res
            .status(404)
            .json({ error: "Completion report not found." });
        const now = new Date().toISOString(),
          nextStatus =
            parsed.data.decision === "Approved" ? "completed" : "in_progress";
        await db.transaction().execute(async (tx) => {
          await tx
            .updateTable("job_completion_reports")
            .set({
              status: parsed.data.decision,
              reviewed_at: now,
              updated_at: now,
            })
            .where("id", "=", completion.id)
            .execute();
          await tx
            .updateTable("operations_service_requests")
            .set({ status: nextStatus, updated_at: now })
            .where("id", "=", completion.request_id)
            .execute();
          if (parsed.data.customerNote)
            await tx
              .insertInto("operations_comments")
              .values({
                id: randomUUID(),
                request_id: completion.request_id,
                actor_type: "Owner",
                actor_id: config.adminUsername,
                body: parsed.data.customerNote,
                visibility: "Customer",
                created_at: now,
              })
              .execute();
          if (parsed.data.decision === "Approved" && parsed.data.publishMediaIds.length)
            await tx
              .updateTable("operations_request_media")
              .set({ visibility: "Customer" })
              .where("request_id", "=", completion.request_id)
              .where("id", "in", parsed.data.publishMediaIds)
              .execute();
          if (parsed.data.decision === "Approved")
            await tx
              .insertInto("property_activity")
              .values({
                id: randomUUID(),
                property_id: completion.property_id,
                request_id: completion.request_id,
                inspection_id: null,
                event_type: "Work completed",
                summary: `${completion.request_number} completed`,
                visibility: "Customer",
                created_at: now,
              })
              .execute();
        });
        await history(
          db,
          completion.request_id,
          "Owner",
          config.adminUsername,
          `Completion ${parsed.data.decision.toLowerCase()}`,
          completion.request_status,
          nextStatus,
          {},
          true,
        );
        res.json({ status: nextStatus });
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    "/api/admin/inspections/:inspectionId/findings/:findingId/work-request",
    async (req, res, next) => {
      try {
        const parsed = z
          .object({
            organizationId: z.string().uuid(),
            title: text(160),
            category: text(100),
            priority: z.enum(["Routine", "Soon", "Urgent"]),
          })
          .safeParse(req.body);
        if (!parsed.success)
          return res
            .status(400)
            .json({ error: "Check the work request details." });
        const finding = await db
          .selectFrom("inspection_findings")
          .innerJoin(
            "inspections",
            "inspections.id",
            "inspection_findings.inspection_id",
          )
          .select([
            "inspection_findings.id",
            "inspection_findings.title",
            "inspection_findings.details",
            "inspections.id as inspection_id",
            "inspections.property_id",
          ])
          .where("inspections.id", "=", routeParam(req, "inspectionId"))
          .where("inspection_findings.id", "=", routeParam(req, "findingId"))
          .executeTakeFirst();
        if (!finding)
          return res
            .status(404)
            .json({ error: "Inspection finding not found." });
        const organization = await db
          .selectFrom("organizations")
          .innerJoin(
            "properties",
            "properties.client_id",
            "organizations.client_id",
          )
          .select("organizations.id")
          .where("organizations.id", "=", parsed.data.organizationId)
          .where("properties.id", "=", finding.property_id)
          .executeTakeFirst();
        if (!organization)
          return res
            .status(409)
            .json({
              error: "The property is not assigned to that organization.",
            });
        const id = randomUUID(),
          number = await nextRequestNumber(db),
          now = new Date().toISOString();
        await db.transaction().execute(async (tx) => {
          await tx
            .insertInto("operations_service_requests")
            .values({
              id,
              request_number: number,
              organization_id: organization.id,
              property_id: finding.property_id,
              created_by_user_id: null,
              inspection_id: finding.inspection_id,
              finding_id: finding.id,
              title: parsed.data.title,
              category: parsed.data.category,
              description: finding.details,
              priority: parsed.data.priority,
              status: "owner_review",
              permission_to_enter: 0,
              occupancy_status: "Unknown",
              preferred_service_date: null,
              preferred_service_window: "",
              spending_limit_cents: null,
              access_instructions: "",
              customer_notes: "",
              internal_notes: `Created from inspection finding: ${finding.title}`,
              channel_id: null,
              assigned_technician_id: null,
              assigned_vendor_id: null,
              scheduled_at: null,
              created_at: now,
              updated_at: now,
            })
            .execute();
          const media = await tx
            .selectFrom("inspection_media")
            .innerJoin(
              "inspection_media_links",
              "inspection_media_links.media_id",
              "inspection_media.id",
            )
            .select([
              "inspection_media.id",
              "inspection_media.file_name",
              "inspection_media.mime_type",
              "inspection_media.size_bytes",
            ])
            .where("inspection_media.inspection_id", "=", finding.inspection_id)
            .where("inspection_media_links.finding_id", "=", finding.id)
            .execute();
          for (const item of media)
            await tx
              .insertInto("operations_request_media")
              .values({
                id: randomUUID(),
                request_id: id,
                inspection_media_id: item.id,
                storage_key: null,
                kind: "Photo",
                file_name: item.file_name,
                mime_type: item.mime_type,
                size_bytes: item.size_bytes,
                visibility: "Customer",
                created_at: now,
              })
              .execute();
          await tx
            .insertInto("property_activity")
            .values({
              id: randomUUID(),
              property_id: finding.property_id,
              request_id: id,
              inspection_id: finding.inspection_id,
              event_type: "Inspection work request",
              summary: `${number} created from inspection finding`,
              visibility: "Customer",
              created_at: now,
            })
            .execute();
        });
        await history(
          db,
          id,
          "Owner",
          config.adminUsername,
          "Created from inspection finding",
          null,
          "owner_review",
          { inspectionId: finding.inspection_id, findingId: finding.id },
          true,
        );
        res.status(201).json({ id, requestNumber: number });
      } catch (e) {
        next(e);
      }
    },
  );
}

async function uploadRequestMedia(
  req: OperationsRequest,
  res: express.Response,
  next: express.NextFunction,
  db: Kysely<TaskCoreDatabase>,
  config: AppConfig,
  audience: "manager" | "vendor",
) {
  try {
    const p = req.operationsPrincipal!,
      requestId = routeParam(req, "id");
    let allowed = false;
    if (audience === "manager" && p.type === "organization_user")
      allowed = Boolean(
        await scopedManagerRequest(db, requestId, p.organizationId),
      );
    if (audience === "vendor" && p.type === "vendor")
      allowed = Boolean(
        await db
          .selectFrom("operations_service_requests")
          .select("id")
          .where("id", "=", requestId)
          .where("assigned_vendor_id", "=", p.id)
          .executeTakeFirst(),
      );
    if (!allowed) return res.status(404).json({ error: "Request not found." });
    const mimeType = ((req.get("content-type") || "").split(";")[0] || "")
        .trim()
        .toLowerCase(),
      extension = uploadExtension(mimeType);
    if (!extension)
      return res
        .status(415)
        .json({ error: "Upload a supported photo or video." });
    const kind = mimeType.startsWith("video/") ? "Video" : "Photo",
      id = randomUUID(),
      key = `operations/${requestId}/${id}${extension}`,
      destination = stagedMediaPath(config, key);
    if (!destination) throw new Error("Invalid media path.");
    const size = await receiveUpload(
      req,
      destination,
      kind === "Video" ? config.maxVideoBytes : config.maxPhotoBytes,
    );
    await persistMedia(config, key, destination, mimeType);
    await db
      .insertInto("operations_request_media")
      .values({
        id,
        request_id: requestId,
        inspection_media_id: null,
        storage_key: key,
        kind,
        file_name: cleanFileName(req.get("x-file-name")),
        mime_type: mimeType,
        size_bytes: size,
        visibility: audience === "manager" ? "Customer" : "Internal",
        created_at: new Date().toISOString(),
      })
      .execute();
    res.status(201).json({ id, kind, sizeBytes: size });
  } catch (e) {
    next(e);
  }
}
async function sendScopedMedia(
  req: OperationsRequest,
  res: express.Response,
  next: express.NextFunction,
  db: Kysely<TaskCoreDatabase>,
  config: AppConfig,
  audience: "manager" | "vendor",
) {
  try {
    const p = req.operationsPrincipal!,
      requestId = routeParam(req, "requestId"),
      media = await db
        .selectFrom("operations_request_media")
        .selectAll()
        .where("id", "=", routeParam(req, "mediaId"))
        .where("request_id", "=", requestId)
        .executeTakeFirst();
    if (!media) return res.status(404).json({ error: "Media not found." });
    let allowed = false;
    if (
      audience === "manager" &&
      p.type === "organization_user" &&
      media.visibility === "Customer"
    )
      allowed = Boolean(
        await scopedManagerRequest(db, requestId, p.organizationId),
      );
    if (
      audience === "vendor" &&
      p.type === "vendor" &&
      media.visibility !== "Internal"
    )
      allowed = Boolean(
        await db
          .selectFrom("contractor_offers")
          .select("id")
          .where("request_id", "=", requestId)
          .where("vendor_id", "=", p.id)
          .where("status", "in", ["Offered", "Accepted"])
          .executeTakeFirst(),
      );
    if (!allowed) return res.status(404).json({ error: "Media not found." });
    if (media.inspection_media_id) {
      const linked = await db
        .selectFrom("inspection_media")
        .selectAll()
        .where("id", "=", media.inspection_media_id)
        .executeTakeFirst();
      if (!linked) return res.status(404).json({ error: "Media not found." });
      return sendMedia(
        config,
        linked.storage_key,
        linked.mime_type,
        res,
        req.get("range"),
      );
    }
    if (!media.storage_key)
      return res.status(404).json({ error: "Media not found." });
    await sendMedia(
      config,
      media.storage_key,
      media.mime_type,
      res,
      req.get("range"),
    );
  } catch (e) {
    next(e);
  }
}
