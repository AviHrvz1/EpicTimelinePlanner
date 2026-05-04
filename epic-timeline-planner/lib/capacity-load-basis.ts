/** What drives capacity gauges and “planned” load: epic Est days vs Σ Child (story estimates). */
export type CapacityLoadBasis = "originalEstimate" | "child";

export const CAPACITY_LOAD_BASIS_STORAGE_KEY = "epicPlanner.capacityLoadBasis.v1";

export function parseCapacityLoadBasis(raw: string | null | undefined): CapacityLoadBasis {
  return raw === "child" ? "child" : "originalEstimate";
}
