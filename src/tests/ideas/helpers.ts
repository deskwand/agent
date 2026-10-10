import path from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库根：src/tests/ideas/helpers.ts → ../../.. */
export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
