import type { PetState } from "../main/desktop-pet/pet-state";

/** 小火苗：体量与亮度就是情绪。分层约定见 styles/pet/flame.css 顶部注释。 */
export function PetFlame({ state }: { state: PetState }) {
  return (
    <div className="pet-flame" data-state={state} aria-hidden="true">
      <svg className="pet-art" viewBox="0 0 72 72">
        <g className="pet-flame__pose">
          <g className="pet-flame__tongue">
            <path
              className="pet-flame__flame pet-out"
              d="M33 6 C36 12 35 17 41 23 C48 30 52 36 52 44 C52 54 45 62 36 62 C26 62 19 54 19 44 C19 33 28 24 33 6 Z"
            />
            <path
              className="pet-flame__tongue-tip pet-out"
              d="M22 44 C18 37 19 30 25 23 C24 31 27 36 30 41 C30 46 27 50 22 44 Z"
            />
          </g>
          <g className="pet-flame__body">
            <path
              className="pet-flame__core"
              d="M36 30 C41 36 44 40 44 46 C44 52 41 56 36 56 C31 56 28 52 28 46 C28 40 31 36 36 30 Z"
            />
          </g>
          <g className="pet-flame__eyes pet-flame__eyes--dot">
            <ellipse cx="31" cy="45" rx="2.3" ry="2.9" />
            <ellipse cx="41" cy="45" rx="2.3" ry="2.9" />
          </g>
          <g className="pet-flame__eyes pet-flame__eyes--arc">
            <path d="M28 45 q3 -4.5 6 0" />
            <path d="M38 45 q3 -4.5 6 0" />
          </g>
          <g className="pet-flame__sparks">
            <circle cx="16" cy="18" r="2" />
            <circle cx="58" cy="14" r="1.6" />
            <circle cx="60" cy="30" r="1.3" />
          </g>
          <g className="pet-flame__eyes pet-flame__eyes--dash">
            <path d="M28 46 q3 3 6 0" />
            <path d="M38 46 q3 3 6 0" />
          </g>
        </g>
        <g className="pet-flame__smoke">
          <path d="M40 22 q6 -6 2 -12" />
        </g>
      </svg>
    </div>
  );
}
