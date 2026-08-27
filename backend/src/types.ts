import type { Generated } from "kysely";

export const REQUEST_STATUSES = ["New", "Contacted", "Scheduled", "Completed", "Declined"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const INSPECTION_TYPES = ["Arrival", "Departure", "Maintenance Documentation"] as const;
export type InspectionType = (typeof INSPECTION_TYPES)[number];
export const INSPECTION_STATUSES = ["Draft", "Submitted", "Needs Changes", "Ready", "Published"] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];
export const FINDING_PRIORITIES = ["Routine", "Urgent", "Emergency"] as const;
export type FindingPriority = (typeof FINDING_PRIORITIES)[number];
export const FINDING_DECISIONS = ["Pending", "Approved", "Declined"] as const;
export type FindingDecision = (typeof FINDING_DECISIONS)[number];

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
}
