export type ChecklistTemplateItem = { key: string; section: string; label: string };

const sections = (groups: Array<[string, Array<[string, string]>]>): ChecklistTemplateItem[] =>
  groups.flatMap(([section, items]) => items.map(([key, label]) => ({ key, section, label })));

export const CHECKLIST_TEMPLATES = {
  Arrival: sections([
    ["Guest readiness", [["arrival-final-presentation", "Property presentation is guest-ready"], ["arrival-welcome", "Welcome materials and arrival instructions are in place"]]],
    ["Access", [["arrival-access", "Entry codes, keys, remotes, and gates work"], ["arrival-locks", "Exterior doors and windows lock correctly"]]],
    ["Cleanliness", [["arrival-cleanliness", "Interior is professionally clean with no odors"], ["arrival-linens", "Linens and towels are clean and staged"]]],
    ["Utilities", [["arrival-utilities", "Power, water, hot water, and gas are available"], ["arrival-leaks", "No visible plumbing leaks or moisture"]]],
    ["HVAC", [["arrival-hvac", "HVAC operates and thermostat is at the arrival setting"]]],
    ["Kitchen", [["arrival-kitchen", "Kitchen surfaces, appliances, and cookware are ready"]]],
    ["Bathrooms", [["arrival-bathrooms", "Bathrooms, fixtures, drains, and toiletries are ready"]]],
    ["Bedrooms", [["arrival-bedrooms", "Bedrooms, beds, lighting, and storage are ready"]]],
    ["Technology", [["arrival-technology", "Wi-Fi, televisions, and smart-home controls work"]]],
    ["Amenities", [["arrival-amenities", "Pool, spa, grill, exterior, and listed amenities are ready"]]],
    ["Safety equipment", [["arrival-safety", "Smoke/CO devices, extinguishers, and safety equipment appear ready"]]],
    ["Supplies", [["arrival-supplies", "Required consumables and guest supplies are stocked"]]],
    ["Visible damage", [["arrival-damage", "No new visible damage or condition concerns"]]],
    ["Final readiness", [["arrival-ready", "Final walkthrough confirms the property is ready for arrival"]]]
  ]),
  Departure: sections([
    ["Security", [["departure-security", "Property is vacant and secured"]]],
    ["Cleanliness", [["departure-cleanliness", "Departure cleanliness is documented"]]],
    ["Trash", [["departure-trash", "Trash, recycling, and food waste are documented"]]],
    ["Damage", [["departure-damage", "New interior or exterior damage is documented"]]],
    ["Leaks", [["departure-leaks", "Plumbing fixtures and visible areas show no leaks"]]],
    ["Missing inventory", [["departure-inventory", "Missing or displaced inventory is documented"]]],
    ["Electronics", [["departure-electronics", "TVs, remotes, Wi-Fi, and smart devices are present and normal"]]],
    ["Locks and access", [["departure-locks", "Keys, remotes, windows, doors, and access devices are accounted for"]]],
    ["Exterior and amenities", [["departure-amenities", "Exterior, pool/spa, grill, and amenities are documented"]]],
    ["Belongings left behind", [["departure-belongings", "Guest belongings left behind are documented"]]],
    ["Maintenance concerns", [["departure-maintenance", "Maintenance concerns discovered at departure are documented"]]],
    ["Overall departure condition", [["departure-overall", "Overall departure condition and turnover needs are documented"]]]
  ])
} as const;

export function checklistTemplate(type: string): ChecklistTemplateItem[] {
  return type === "Arrival" || type === "Departure" ? [...CHECKLIST_TEMPLATES[type]] : [];
}
