import { contextBridge, ipcRenderer } from "electron";

type PetState = "idle" | "running" | "success" | "failure";

contextBridge.exposeInMainWorld("petAPI", {
  onState: (listener: (state: PetState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: PetState) =>
      listener(state);
    ipcRenderer.on("pet.state", handler);
    return () => ipcRenderer.removeListener("pet.state", handler);
  },
  activate: () => ipcRenderer.send("pet.activate"),
  onCharacter: (listener: (character: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, character: string) =>
      listener(character);
    ipcRenderer.on("pet.character", handler);
    return () => ipcRenderer.removeListener("pet.character", handler);
  },
  /** 右键时只报告"要开菜单"：清单、当前值、文案都在主进程手里。 */
  openCharacterMenu: () => ipcRenderer.send("pet.menu"),
  drag: (delta: { dx: number; dy: number; done: boolean }) =>
    ipcRenderer.send("pet.drag", delta),
});
