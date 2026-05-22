import {contextBridge, ipcRenderer} from 'electron';
import type {DeckSpec} from '../src/shared/deck.js';
import type {ExportResult, RenderJob, RenderProgress} from '../src/global.js';

contextBridge.exposeInMainWorld('khutbahApi', {
  chooseOutput: (kind: 'html' | 'mp4') => ipcRenderer.invoke('dialog:chooseOutput', kind) as Promise<string | null>,
  exportHtml: (deck: DeckSpec, outputPath: string) =>
    ipcRenderer.invoke('deck:exportHtml', deck, outputPath) as Promise<ExportResult>,
  startRender: (deck: DeckSpec, outputPath: string) =>
    ipcRenderer.invoke('render:start', deck, outputPath) as Promise<RenderJob>,
  cancelRender: (jobId: string) => ipcRenderer.invoke('render:cancel', jobId) as Promise<void>,
  onRenderProgress: (listener: (progress: RenderProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: RenderProgress) => listener(progress);
    ipcRenderer.on('render:progress', handler);
    return () => ipcRenderer.removeListener('render:progress', handler);
  },
});
