import type { PetState } from "../main/desktop-pet/pet-state";

export function PetCustom({
  state,
  src,
  onError,
}: {
  state: PetState;
  src: string;
  onError: () => void;
}) {
  return (
    <div className="pet-custom" data-state={state} aria-hidden="true">
      <img
        className="pet-custom__img"
        src={src}
        alt=""
        draggable={false}
        onError={onError}
      />
    </div>
  );
}
