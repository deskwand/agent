import type { ApiTestInput, ApiTestResult } from "../../renderer/types";
import type { AppConfig } from "./config-store";
import { probeWithAgentSdk } from "../agent/agent-sdk-one-shot";

export async function runConfigApiTest(
  payload: ApiTestInput,
  config: AppConfig,
): Promise<ApiTestResult> {
  return probeWithAgentSdk(payload, config);
}
