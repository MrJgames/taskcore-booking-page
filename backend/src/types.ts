import type { Generated } from "kysely";

export const REQUEST_STATUSES = [
  "New",
  "Contacted",
  "Scheduled",
  "Completed",
  "Declined",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const INSPECTION_TYPES = [
  "Arrival",
  "Departure",
  "Maintenance Documentation",
] as const;
export type InspectionType = (typeof INSPECTION_TYPES)[number];
export const INSPECTION_STATUSES = [
  "Draft",
  "Submitted",
  "Needs Changes",
  "Ready",
  "Published",
] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];
export const FINDING_PRIORITIES = ["Routine", "Urgent", "Emergency"] as const;
export type FindingPriority = (typeof FINDING_PRIORITIES)[number];
export const FINDING_DECISIONS = ["Pending", "Approved", "Declined"] as const;
export type FindingDecision = (typeof FINDING_DECISIONS)[number];
export const SYSTEM_UNASSIGNED_CLIENT_ID =
  "00000000-0000-4000-8000-000000000001";
export const PENDING_PROPERTY_ASSIGNMENT = "Pending Client Assignment" as const;
export const OPERATIONS_REQUEST_STATUSES = [
  "submitted",
  "owner_review",
  "needs_information",
  "estimating",
  "awaiting_approval",
  "approved",
  "dispatching",
  "offered_to_vendor",
  "assigned",
  "scheduled",
  "in_progress",
  "awaiting_completion_review",
  "completed",
  "declined",
  "cancelled",
  "closed",
] as const;
export type OperationsRequestStatus =
  (typeof OPERATIONS_REQUEST_STATUSES)[number];

export interface ServiceRequestsTable {
  id: string;
  created_at: string;
  customer_name: string;
  phone: string;
  email: string | null;
  service_address: string;
  issue_description: string;
  preferred_contact_method: string;
  preferred_service_date: string;
  requested_arrival_window: string;
  submitted_at: string;
  status: RequestStatus;
  private_note: Generated<string | null>;
  updated_at: string;
}

export interface ClientsTable {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  created_at: string;
}

export interface PropertiesTable {
  id: string;
  client_id: string;
  name: string;
  address: string;
  active: Generated<number>;
  created_at: string;
}

export interface TechniciansTable {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  active: Generated<number>;
  created_at: string;
}

export interface TechnicianSessionsTable {
  id: string;
  technician_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
}

export interface InspectionsTable {
  id: string;
  property_id: string;
  technician_id: string;
  inspection_type: InspectionType;
  status: InspectionStatus;
  checklist_json: Generated<string>;
  summary: Generated<string>;
  review_note: Generated<string>;
  submitted_at: string | null;
  reviewed_at: string | null;
  published_at: string | null;
  report_token_hash: string | null;
  report_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InspectionMediaTable {
  id: string;
  inspection_id: string;
  kind: "Photo" | "Walkthrough";
  category: string;
  caption: string;
  storage_key: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface InspectionFindingsTable {
  id: string;
  inspection_id: string;
  title: string;
  details: string;
  priority: FindingPriority;
  requires_approval: Generated<number>;
  quote_description: Generated<string>;
  quote_amount_cents: number | null;
  decision: Generated<FindingDecision>;
  client_comment: Generated<string>;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationsTable {
  id: string;
  inspection_id: string;
  message: string;
  delivery_status: string;
  read_at: string | null;
  created_at: string;
}

export interface InspectionDecisionEventsTable {
  id: string;
  finding_id: string;
  decision: "Approved" | "Declined";
  client_comment: string;
  created_at: string;
}

export interface TechnicianActivityEventsTable {
  id: string;
  technician_id: string;
  inspection_id: string | null;
  event_type: string;
  created_at: string;
}

export interface TechnicianOperationsTable {
  id: string;
  technician_id: string;
  inspection_id: string | null;
  operation_type: string;
  response_json: string;
  created_at: string;
}

export interface InspectionMediaLinksTable {
  media_id: string;
  question_key: string | null;
  finding_id: string | null;
}

export interface MaintenanceFindingDetailsTable {
  finding_id: string;
  category: string;
  immediate_safety_actions: string;
  recommended_next_steps: string;
  materials_needed: string;
  review_status: string;
}

export interface MaintenanceFindingEventsTable {
  id: string;
  finding_id: string;
  actor_type: "Technician" | "Owner" | "Client";
  action: string;
  snapshot_json: string;
  created_at: string;
}

export interface PropertyAuditEventsTable {
  id: string;
  property_id: string;
  actor_type: "Technician" | "Owner";
  actor_id: string;
  action: "Created" | "Edited" | "Merged" | "Archived";
  details_json: string;
  created_at: string;
}

export interface PropertyNotificationsTable {
  id: string;
  property_id: string;
  message: string;
  delivery_status: string;
  read_at: string | null;
  created_at: string;
}

export interface PropertyAssignmentStatusTable {
  property_id: string;
  status: typeof PENDING_PROPERTY_ASSIGNMENT;
  created_by_technician_id: string;
  inspection_id: string;
  created_at: string;
}

export interface OrganizationsTable {
  id: string;
  client_id: string;
  name: string;
  active: Generated<number>;
  created_at: string;
  updated_at: string;
}
export interface OrganizationUsersTable {
  id: string;
  organization_id: string;
  role: "Property Manager" | "Property Staff";
  name: string;
  email: string;
  password_hash: string;
  active: Generated<number>;
  created_at: string;
  updated_at: string;
}
export interface VendorsTable {
  id: string;
  business_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  password_hash: string;
  status: string;
  active: Generated<number>;
  w9_status: string;
  insurance_status: string;
  license_status: string;
  license_number: string;
  license_type: string;
  license_expires_at: string | null;
  insurance_expires_at: string | null;
  internal_notes: string;
  created_at: string;
  updated_at: string;
}
export interface OperationsSessionsTable {
  id: string;
  principal_type: "organization_user" | "vendor";
  principal_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
}
export interface WorkChannelsTable {
  id: string;
  name: string;
  description: Generated<string>;
  sort_order: Generated<number>;
  active: Generated<number>;
  compliance_review_recommended: Generated<number>;
  created_at: string;
  updated_at: string;
}
export interface TechnicianChannelsTable {
  technician_id: string;
  channel_id: string;
}
export interface VendorChannelsTable {
  vendor_id: string;
  channel_id: string;
}
export interface OperationsServiceRequestsTable {
  id: string;
  request_number: string;
  organization_id: string;
  property_id: string;
  created_by_user_id: string | null;
  inspection_id: string | null;
  finding_id: string | null;
  title: string;
  category: string;
  description: string;
  priority: "Routine" | "Soon" | "Urgent";
  status: OperationsRequestStatus;
  permission_to_enter: Generated<number>;
  occupancy_status: string;
  preferred_service_date: string | null;
  preferred_service_window: string;
  spending_limit_cents: number | null;
  access_instructions: string;
  customer_notes: string;
  internal_notes: string;
  technician_notes: Generated<string>;
  channel_id: string | null;
  assigned_technician_id: string | null;
  assigned_vendor_id: string | null;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface TechnicianTaskDetailsTable {
  request_id: string;
  task_type: "Diagnose / Check Issue" | "Quote / Estimate Request" | "Approved Service Call";
  findings: Generated<string>;
  measurements_notes: Generated<string>;
  recommended_repair: Generated<string>;
  specialist_needed: Generated<number>;
  estimated_labor_hours: number | null;
  estimated_materials: Generated<string>;
  estimated_material_cost_cents: number | null;
  proposed_labor_cents: number | null;
  proposed_total_cents: number | null;
  customer_price_cents: number | null;
  review_status: Generated<"Draft" | "Owner Review" | "More Information Requested" | "Approved" | "Declined">;
  operation_id: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface OperationsRequestMediaTable {
  id: string;
  request_id: string;
  inspection_media_id: string | null;
  storage_key: string | null;
  kind: "Photo" | "Video" | "Invoice";
  purpose: Generated<string>;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  visibility: "Customer" | "Internal" | "Contractor";
  created_at: string;
}
export interface OperationsRequestHistoryTable {
  id: string;
  request_id: string;
  actor_type:
    | "Owner"
    | "Organization User"
    | "Technician"
    | "Vendor"
    | "System";
  actor_id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  details_json: string;
  customer_visible: Generated<number>;
  created_at: string;
}
export interface OperationsCommentsTable {
  id: string;
  request_id: string;
  actor_type: "Owner" | "Organization User" | "Technician" | "Vendor";
  actor_id: string;
  body: string;
  visibility: "Customer" | "Internal" | "Contractor";
  created_at: string;
}
export interface EstimatesTable {
  id: string;
  request_id: string;
  status:
    | "Draft"
    | "Awaiting Approval"
    | "Approved"
    | "Declined"
    | "Changes Requested";
  current_revision: number;
  created_at: string;
  updated_at: string;
}
export interface EstimateRevisionsTable {
  id: string;
  estimate_id: string;
  revision_number: number;
  amount_cents: number;
  scope: string;
  customer_note: string;
  created_by: string;
  created_at: string;
}
export interface EstimateApprovalsTable {
  id: string;
  estimate_id: string;
  organization_user_id: string;
  decision: "Approved" | "Declined" | "Changes Requested";
  comment: string;
  created_at: string;
}
export interface ContractorOffersTable {
  id: string;
  request_id: string;
  vendor_id: string;
  scope: string;
  offered_compensation_cents: number;
  service_window: string;
  status: "Offered" | "Accepted" | "Declined" | "Withdrawn";
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface JobCompletionReportsTable {
  id: string;
  request_id: string;
  vendor_id: string | null;
  technician_id: Generated<string | null>;
  completion_notes: string;
  customer_completion_notes: Generated<string>;
  materials_notes: string;
  material_cost_notes: Generated<string>;
  time_spent_minutes: number | null;
  invoice_amount_cents: number | null;
  status: "Submitted" | "Approved" | "Changes Requested" | "Published";
  reviewed_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface TechnicianJobUpdatesTable {
  id: string;
  request_id: string;
  technician_id: string;
  update_type:
    | "Acknowledged"
    | "Started"
    | "Work Note"
    | "Blocker"
    | "Completion Submitted"
    | "Owner Correction Requested";
  notes: string;
  materials_used: string;
  material_cost_notes: string;
  time_spent_minutes: number | null;
  created_at: string;
}
export interface OperationsNotificationsTable {
  id: string;
  organization_id: string | null;
  organization_user_id: string | null;
  vendor_id: string | null;
  technician_id: Generated<string | null>;
  request_id: string | null;
  event_type: string;
  message: string;
  read_at: string | null;
  created_at: string;
}
export interface PropertyActivityTable {
  id: string;
  property_id: string;
  request_id: string | null;
  inspection_id: string | null;
  event_type: string;
  summary: string;
  visibility: "Customer" | "Internal";
  created_at: string;
}

export interface TaskCoreDatabase {
  service_requests: ServiceRequestsTable;
  clients: ClientsTable;
  properties: PropertiesTable;
  technicians: TechniciansTable;
  technician_sessions: TechnicianSessionsTable;
  technician_activity_events: TechnicianActivityEventsTable;
  technician_operations: TechnicianOperationsTable;
  inspections: InspectionsTable;
  inspection_media: InspectionMediaTable;
  inspection_findings: InspectionFindingsTable;
  notifications: NotificationsTable;
  inspection_decision_events: InspectionDecisionEventsTable;
  inspection_media_links: InspectionMediaLinksTable;
  maintenance_finding_details: MaintenanceFindingDetailsTable;
  maintenance_finding_events: MaintenanceFindingEventsTable;
  property_audit_events: PropertyAuditEventsTable;
  property_notifications: PropertyNotificationsTable;
  property_assignment_status: PropertyAssignmentStatusTable;
  organizations: OrganizationsTable;
  organization_users: OrganizationUsersTable;
  vendors: VendorsTable;
  operations_sessions: OperationsSessionsTable;
  work_channels: WorkChannelsTable;
  technician_channels: TechnicianChannelsTable;
  vendor_channels: VendorChannelsTable;
  operations_service_requests: OperationsServiceRequestsTable;
  technician_task_details: TechnicianTaskDetailsTable;
  operations_request_media: OperationsRequestMediaTable;
  operations_request_history: OperationsRequestHistoryTable;
  operations_comments: OperationsCommentsTable;
  estimates: EstimatesTable;
  estimate_revisions: EstimateRevisionsTable;
  estimate_approvals: EstimateApprovalsTable;
  contractor_offers: ContractorOffersTable;
  job_completion_reports: JobCompletionReportsTable;
  technician_job_updates: TechnicianJobUpdatesTable;
  operations_notifications: OperationsNotificationsTable;
  property_activity: PropertyActivityTable;
}
