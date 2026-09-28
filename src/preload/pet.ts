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
  drag: (delta: { dx: number; dy: number; done: boolean }) =>
    ipcRenderer.send("pet.drag", delta),
});
