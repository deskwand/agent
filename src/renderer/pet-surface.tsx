import { useState } from "react";
import type { PetState } from "../main/desktop-pet/pet-state";
import type { PetCharacter } from "../shared/pet-characters";
import { PET_CHARACTER_COMPONENTS } from "./pet-characters";
import { PetCustom } from "./pet-custom";

export function PetSurface({
  state,
  character,
  image,
}: {
  state: PetState;
  character: PetCharacter;
  image: string | null;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (image && image !== failedSrc) {
    return (
      <PetCustom
        state={state}
        src={image}
        onError={() => setFailedSrc(image)}
      />
    );
  }

  const Character = PET_CHARACTER_COMPONENTS[character];
  return <Character state={state} />;
}
