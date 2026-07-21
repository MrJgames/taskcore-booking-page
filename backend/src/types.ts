import type { Generated } from "kysely";

export const REQUEST_STATUSES = ["New", "Contacted", "Scheduled", "Completed", "Declined"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

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

export interface TaskCoreDatabase {
  service_requests: ServiceRequestsTable;
}
