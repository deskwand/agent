import type { PetState } from "../main/desktop-pet/pet-state";

export function PetLens({ state }: { state: PetState }) {
  return (
    <div className="pet-lens" data-state={state} aria-hidden="true">
      <div className="pet-lens__rim">
        <div className="pet-lens__eye" />
      </div>
    </div>
  );
}
