import devops from "./devops.json" with { type: "json" }

export interface SeedEntry {
  readonly term: string
  readonly aliases: ReadonlyArray<string>
}

/**
 * The seed is data, not code. It is the same DevOps vocabulary that the first
 * iteration accumulated, stripped of `era` ratings: the second iteration does
 * not store technology fashion.
 */
export const DEVOPS_SEED: ReadonlyArray<SeedEntry> = devops
