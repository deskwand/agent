/**
 * Must be imported before any module that reads app.getPath("userData").
 * Electron's setPath must be called before the first getPath, otherwise
 * stores like electron-store/conf will use the default OS-specific path.
 */
import { app } from "electron";
import { join } from "path";
import * as os from "node:os";

app.setPath("userData", join(os.homedir(), ".omagt"));
