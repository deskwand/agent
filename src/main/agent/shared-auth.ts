import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { app } from "electron";
import { join } from "path";

// Singleton — safe because Electron main process is single-threaded.
// AuthStorage.create() is synchronous, so no async race possible.
let sharedAuthStorage: AuthStorage | null = null;

export function getSharedAuthStorage(): AuthStorage {
  if (!sharedAuthStorage) {
    const userDataPath = app.getPath("userData");
    sharedAuthStorage = AuthStorage.create(join(userDataPath, "auth.json"));
  }
  return sharedAuthStorage;
}

export { AuthStorage, ModelRegistry };
