/**
 * AMAYRA — shared memory types.
 *
 * `Memory` is the legacy flat memory card persisted to memories.json and used
 * by the Gemini memory-consolidation pipeline. `MemoryTransaction` is the
 * structured ADD/UPDATE/REMOVE action returned by the consolidation model.
 */

export type MemoryCategory =
  | "identity"
  | "preference"
  | "goal"
  | "project"
  | "relationship"
  | "emotional"
  | "behavior";

export interface Memory {
  id: string;
  category: MemoryCategory;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryTransaction {
  action: "ADD" | "UPDATE" | "REMOVE";
  /** Required for UPDATE/REMOVE; blank for ADD. */
  id?: string;
  category: MemoryCategory;
  text: string;
}
