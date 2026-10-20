import { contextBridge, ipcRenderer } from "electron";
import type { PetAppearance } from "../shared/pet-appearance";

type PetState = "idle" | "running" | "success" | "failure";

contextBridge.exposeInMainWorld("petAPI", {
  onState: (listener: (state: PetState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: PetState) =>
      listener(state);
    ipcRenderer.on("pet.state", handler);
    return () => ipcRenderer.removeListener("pet.state", handler);
  },
  activate: () => ipcRenderer.send("pet.activate"),
  onAppearance: (listener: (appearance: PetAppearance) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      appearance: PetAppearance,
    ) => listener(appearance);
    ipcRenderer.on("pet.appearance", handler);
    return () => ipcRenderer.removeListener("pet.appearance", handler);
  },
  /** 右键时只报告"要开菜单"：清单、当前值、文案都在主进程手里。 */
  openCharacterMenu: () => ipcRenderer.send("pet.menu"),
  drag: (delta: { dx: number; dy: number; done: boolean }) =>
    ipcRenderer.send("pet.drag", delta),
});
