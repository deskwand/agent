import type { PetState } from "../main/desktop-pet/pet-state";

/** 小水母：伞体脉动 + 触手随水漂。触手各自成组，靠 rotate 表达收拢/散开。 */
export function PetJellyfish({ state }: { state: PetState }) {
  return (
    <div className="pet-jellyfish" data-state={state} aria-hidden="true">
      <svg className="pet-art" viewBox="0 0 72 72">
        <g className="pet-jellyfish__pose">
          <g className="pet-jellyfish__pulse">
            <g className="pet-jellyfish__bell">
              {[24, 36, 48].map((x, i) => (
                <g
                  key={x}
                  className={`pet-jellyfish__tent pet-jellyfish__tent--${i + 1}`}
                >
                  <path
                    className="pet-jellyfish__tent-under"
                    d={`M${x} 37 q${i === 2 ? 4 : -4} 9 0 14`}
                  />
                  <path
                    className="pet-jellyfish__tent-fill"
                    d={`M${x} 37 q${i === 2 ? 4 : -4} 9 0 14`}
                  />
                </g>
              ))}
              <path
                className="pet-jellyfish__bell-fill pet-out"
                d="M13 34 C13 20 23 12 36 12 C49 12 59 20 59 34 C59 38 13 38 13 34 Z"
              />
            </g>
          </g>
          <g className="pet-jellyfish__eyes pet-jellyfish__eyes--dot">
            <ellipse cx="30" cy="27" rx="2.6" ry="3.4" />
            <ellipse cx="42" cy="27" rx="2.6" ry="3.4" />
          </g>
          <g className="pet-jellyfish__eyes pet-jellyfish__eyes--arc">
            <path d="M27 27 q3 -4.5 6 0" />
            <path d="M39 27 q3 -4.5 6 0" />
          </g>
          <g className="pet-jellyfish__eyes pet-jellyfish__eyes--dash">
            <path d="M27 28 q3 3 6 0" />
            <path d="M39 28 q3 3 6 0" />
          </g>
        </g>
      </svg>
    </div>
  );
}
