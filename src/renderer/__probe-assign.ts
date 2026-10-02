import type { ComponentType } from "react";
type PetState = "idle" | "running" | "success" | "failure";
const Narrow = ({ state }: { state: PetState }) => null;
const Wide = ({ state, night }: { state: PetState; night: boolean }) => null;
export const map: Record<
  "lens" | "slime",
  ComponentType<{ state: PetState; night: boolean }>
> = { lens: Narrow, slime: Wide };
