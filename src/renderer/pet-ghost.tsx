import type { PetState } from "../main/desktop-pet/pet-state";

/** 小幽灵：情绪靠高度与透明度。分层同史莱姆（见 pet-slime.tsx 注释）。 */
export function PetGhost({ state }: { state: PetState }) {
  return (
    <div className="pet-ghost" data-state={state} aria-hidden="true">
      <svg className="pet-art" viewBox="0 0 72 72">
        <g className="pet-ghost__pose">
          <g className="pet-ghost__drift">
            <g className="pet-ghost__peek">
              <g className="pet-ghost__body">
                <path
                  className="pet-ghost__fill pet-out"
                  d="M15 54 V38 C15 24 24 15 36 15 C48 15 57 24 57 38 V54 Q51 48 46 54 Q41 60 36 54 Q31 48 26 54 Q21 60 15 54 Z"
                />
              </g>
              <g className="pet-ghost__eyes pet-ghost__eyes--dot">
                <ellipse cx="30" cy="36" rx="2.6" ry="3.6" />
                <ellipse cx="42" cy="36" rx="2.6" ry="3.6" />
              </g>
              <g className="pet-ghost__eyes pet-ghost__eyes--arc">
                <path d="M27 36 q3 -4.5 6 0" />
                <path d="M39 36 q3 -4.5 6 0" />
              </g>
              <g className="pet-ghost__eyes pet-ghost__eyes--dash">
                <path d="M27 37 q3 3 6 0" />
                <path d="M39 37 q3 3 6 0" />
              </g>
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
