// shadcn 组件的类名合并入口。
//
// 按 shadcn 2026-09 起的约定统一从 `cn` 包导入（替代 clsx + tailwind-merge
// 的两依赖样板）。`cn` 是运行时库、零配置——`cn` 包的 `./vite` / `./compiler`
// 导出是可选的预编译优化，本项目不需要，故 vite.config.ts 未改动。
//
// 本仓别名 `@renderer/utils/cn` 即指向此处（见根目录 components.json）。
export { cn } from "cn";
