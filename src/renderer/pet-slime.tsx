import type { PetState } from "../main/desktop-pet/pet-state";

/**
 * 史莱姆：情绪靠形变。
 *
 * 分层顺序（见设计文档 §3.2 与计划开头的结构约定）：
 * pose（四态体态）→ puff / sway（招牌小动作，仅 idle）→ body（呼吸 / running 抖动）。
 * 同一元素上只能有一条生效的 transform 动画，所以必须分层。
 */
export function PetSlime({ state }: { state: PetState }) {
  return (
    <div className="pet-slime" data-state={state} aria-hidden="true">
      <svg className="pet-art" viewBox="0 0 72 72">
        <g className="pet-slime__pose">
          <g className="pet-slime__puff">
            <g className="pet-slime__sway">
              <g className="pet-slime__body">
                <path
                  className="pet-slime__fill pet-out"
                  d="M13 50 C13 28 24 16 36 16 C48 16 59 28 59 50 C59 55 13 55 13 50 Z"
                />
                <ellipse
                  className="pet-slime__gloss"
                  cx="28"
                  cy="29"
                  rx="6"
                  ry="4"
                />
              </g>
              <g className="pet-slime__eyes pet-slime__eyes--dot">
                <ellipse cx="29" cy="41" rx="2.4" ry="3" />
                <ellipse cx="43" cy="41" rx="2.4" ry="3" />
              </g>
              <g className="pet-slime__eyes pet-slime__eyes--arc">
                <path d="M25 37 q3.5 -5 7 0" />
                <path d="M40 37 q3.5 -5 7 0" />
              </g>
              <g className="pet-slime__eyes pet-slime__eyes--dash">
                <line x1="25" y1="45" x2="31" y2="45" />
                <line x1="41" y1="45" x2="47" y2="45" />
              </g>
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
