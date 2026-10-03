import type { PetState } from "../main/desktop-pet/pet-state";

/** 原创蛋仔：弹跳与裂痕。legs/arms/crack 各自成组，靠 transform 表达蹬腿、举手、压扁。 */
export function PetEgg({ state }: { state: PetState }) {
  return (
    <div className="pet-egg" data-state={state} aria-hidden="true">
      <svg className="pet-art" viewBox="0 0 72 72">
        <g className="pet-egg__shadow">
          <ellipse cx="36" cy="64" rx="12" ry="3" />
        </g>
        <g className="pet-egg__pose">
          <g className="pet-egg__leg pet-egg__leg--l">
            <ellipse
              cx="30"
              cy="58"
              rx="3.4"
              ry="5"
              className="pet-egg__limb pet-out"
            />
          </g>
          <g className="pet-egg__leg pet-egg__leg--r">
            <ellipse
              cx="40"
              cy="58"
              rx="3.4"
              ry="5"
              className="pet-egg__limb pet-out"
            />
          </g>
          <g className="pet-egg__arm pet-egg__arm--l">
            <path className="pet-egg__arm-under" d="M21 34 q-6 2 -7 6" />
            <path className="pet-egg__arm-fill" d="M21 34 q-6 2 -7 6" />
          </g>
          <g className="pet-egg__arm pet-egg__arm--r">
            <path className="pet-egg__arm-under" d="M51 34 q6 2 7 6" />
            <path className="pet-egg__arm-fill" d="M51 34 q6 2 7 6" />
          </g>
          <g className="pet-egg__body">
            <path
              className="pet-egg__shell pet-out"
              d="M36 12 C47 12 55 24 55 38 C55 52 47 60 36 60 C25 60 17 52 17 38 C17 24 25 12 36 12 Z"
            />
            <path className="pet-egg__crack" d="M30 40 l4 3 l-3 4 l5 3" />
          </g>
          <g className="pet-egg__eyes pet-egg__eyes--dot">
            <ellipse cx="31" cy="31" rx="2.6" ry="3.4" />
            <ellipse cx="41" cy="31" rx="2.6" ry="3.4" />
          </g>
          <g className="pet-egg__eyes pet-egg__eyes--arc">
            <path d="M28 30 q3 -4.5 6 0" />
            <path d="M39 30 q3 -4.5 6 0" />
          </g>
          <g className="pet-egg__eyes pet-egg__eyes--dash">
            <path d="M28 32 q3 3 6 0" />
            <path d="M39 32 q3 3 6 0" />
          </g>
        </g>
      </svg>
    </div>
  );
}
