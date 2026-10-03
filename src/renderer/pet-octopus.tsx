import type { PetState } from "../main/desktop-pet/pet-state";

/** 小章鱼：腕足就是动作语言。画四条（各自成组），靠 rotate/scaleY 表达伸开、上举、摊平。 */
export function PetOctopus({ state }: { state: PetState }) {
  return (
    <div className="pet-octopus" data-state={state} aria-hidden="true">
      <svg className="pet-art" viewBox="0 0 72 72">
        <g className="pet-octopus__pose">
          <g className="pet-octopus__bubble">
            <circle cx="52" cy="12" r="3" />
          </g>
          <g className="pet-octopus__limbs">
            {[
              { x: 22, dx: -8, dy: 9 },
              { x: 31, dx: -5, dy: 12 },
              { x: 41, dx: 5, dy: 12 },
              { x: 50, dx: 8, dy: 9 },
            ].map((t, i) => (
              <g
                key={t.x}
                className={`pet-octopus__tent pet-octopus__tent--${i + 1}`}
              >
                <path
                  className="pet-octopus__tent-under"
                  d={`M${t.x} 44 q${t.dx} ${t.dy}`}
                />
                <path
                  className="pet-octopus__tent-fill"
                  d={`M${t.x} 44 q${t.dx} ${t.dy}`}
                />
              </g>
            ))}
          </g>
          <g className="pet-octopus__body">
            <path
              className="pet-octopus__dome pet-out"
              d="M17 44 C17 26 25 15 36 15 C47 15 55 26 55 44 Z"
            />
          </g>
          <g className="pet-octopus__eyes pet-octopus__eyes--dot">
            <ellipse cx="30" cy="30" rx="2.6" ry="3.4" />
            <ellipse cx="42" cy="30" rx="2.6" ry="3.4" />
          </g>
          <g className="pet-octopus__eyes pet-octopus__eyes--arc">
            <path d="M27 30 q3 -4.5 6 0" />
            <path d="M39 30 q3 -4.5 6 0" />
          </g>
          <g className="pet-octopus__eyes pet-octopus__eyes--dash">
            <path d="M27 31 q3 3 6 0" />
            <path d="M39 31 q3 3 6 0" />
          </g>
        </g>
      </svg>
    </div>
  );
}
