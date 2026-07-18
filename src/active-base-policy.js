/**
 * Release-1.0 email-base view.
 *
 * This is intentionally a visibility policy, not a deletion policy. Legacy
 * brands remain restorable/auditable on disk or in Git while day-to-day UI is
 * limited to the two active product bases and the constructor output area.
 */
export const ACTIVE_EMAIL_BASE_BRANDS = Object.freeze(["X_IQ", "X_IQBroker", "X_assembled"]);
export const SERVICE_EMAIL_BASE_BRANDS = Object.freeze(["X_preview"]);

const activeSet = new Set(ACTIVE_EMAIL_BASE_BRANDS);
const serviceSet = new Set(SERVICE_EMAIL_BASE_BRANDS);

export function isActiveEmailBaseBrand(brand) {
  return activeSet.has(String(brand || ""));
}

export function isServiceEmailBaseBrand(brand) {
  return serviceSet.has(String(brand || ""));
}

export function partitionEmailBaseGroups(groups = []) {
  const active = [];
  const archived = [];
  const service = [];
  for (const group of Array.isArray(groups) ? groups : []) {
    if (isActiveEmailBaseBrand(group?.brand)) active.push(group);
    else if (isServiceEmailBaseBrand(group?.brand)) service.push(group);
    else archived.push(group);
  }
  return { active, archived, service };
}

export function visibleEmailBaseGroups(groups = [], scope = "active") {
  const partitioned = partitionEmailBaseGroups(groups);
  if (scope === "all") return [...partitioned.active, ...partitioned.archived];
  if (scope === "service") return partitioned.service;
  return partitioned.active;
}
