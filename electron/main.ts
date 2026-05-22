import {app, BrowserWindow, dialog, ipcMain} from 'electron';
import {bundle} from '@remotion/bundler';
import {getCompositions, makeCancelSignal, renderMedia} from '@remotion/renderer';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildStandaloneHtml} from '../src/shared/htmlExport.js';
import {DeckSpec, FPS, VIDEO_HEIGHT, VIDEO_WIDTH, getTotalFrames, parseDeckSpec} from '../src/shared/deck.js';

type RenderJobState = {
  cancel: () => void;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const renderJobs = new Map<string, RenderJobState>();

function isDev() {
  return !app.isPackaged;
}

function getAppRoot() {
  return app.getAppPath();
}

function getRenderEntryPoint() {
  return path.join(getAppRoot(), 'src', 'remotion', 'render-entry.tsx');
}

function sendRenderProgress(window: BrowserWindow | null, payload: unknown) {
  if (!window || window.isDestroyed()) {
    return;
  }
  window.webContents.send('render:progress', payload);
}

async function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#0c0f0e',
    title: 'Khutbah Video Generator',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev()) {
    await mainWindow.loadURL('http://127.0.0.1:5173');
    mainWindow.webContents.openDevTools({mode: 'detach'});
  } else {
    await mainWindow.loadFile(path.join(getAppRoot(), 'dist', 'index.html'));
  }
}

app.whenReady().then(async () => {
  registerIpc();
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function registerIpc() {
  ipcMain.handle('dialog:chooseOutput', async (_event, kind: 'html' | 'mp4') => {
    const extension = kind === 'html' ? 'html' : 'mp4';
    const result = await dialog.showSaveDialog({
      title: kind === 'html' ? 'Export HTML deck' : 'Render MP4 video',
      defaultPath: `khutbah-deck.${extension}`,
      filters: [{name: extension.toUpperCase(), extensions: [extension]}],
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle('deck:exportHtml', async (_event, unsafeDeck: unknown, outputPath: string) => {
    const deck = parseDeckSpec(unsafeDeck);
    const html = buildStandaloneHtml(deck);
    await fs.writeFile(outputPath, html, 'utf8');
    return {outputPath};
  });

  ipcMain.handle('render:start', async (event, unsafeDeck: unknown, outputPath: string) => {
    const deck = parseDeckSpec(unsafeDeck);
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const jobId = randomUUID();
    const totalFrames = getTotalFrames(deck);
    const cancelSignal = makeCancelSignal();

    renderJobs.set(jobId, {cancel: cancelSignal.cancel});
    sendRenderProgress(senderWindow, {
      jobId,
      status: 'queued',
      progress: 0,
      currentFrame: 0,
      totalFrames,
      outputPath,
    });

    void renderDeck({deck, outputPath, jobId, totalFrames, senderWindow, cancelSignal}).catch((error: unknown) => {
      renderJobs.delete(jobId);
      sendRenderProgress(senderWindow, {
        jobId,
        status: 'failed',
        progress: 0,
        currentFrame: 0,
        totalFrames,
        outputPath,
        error: error instanceof Error ? error.message : 'Render failed.',
      });
    });

    return {jobId, outputPath};
  });

  ipcMain.handle('render:cancel', async (_event, jobId: string) => {
    const job = renderJobs.get(jobId);
    job?.cancel();
  });
}

async function renderDeck({
  deck,
  outputPath,
  jobId,
  totalFrames,
  senderWindow,
  cancelSignal,
}: {
  deck: DeckSpec;
  outputPath: string;
  jobId: string;
  totalFrames: number;
  senderWindow: BrowserWindow | null;
  cancelSignal: ReturnType<typeof makeCancelSignal>;
}) {
  const serveUrl = await bundle({
    entryPoint: getRenderEntryPoint(),
  });
  const compositions = await getCompositions(serveUrl, {
    inputProps: {deck},
  });
  const composition = compositions.find((candidate) => candidate.id === 'KhutbahDeck');

  if (!composition) {
    throw new Error('Unable to find Remotion composition KhutbahDeck.');
  }

  sendRenderProgress(senderWindow, {
    jobId,
    status: 'rendering',
    progress: 0,
    currentFrame: 0,
    totalFrames,
    outputPath,
  });

  try {
    await renderMedia({
      composition: {
        ...composition,
        durationInFrames: totalFrames,
        fps: FPS,
        width: VIDEO_WIDTH,
        height: VIDEO_HEIGHT,
      },
      serveUrl,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps: {deck},
      cancelSignal: cancelSignal.cancelSignal,
      onProgress: ({progress, renderedFrames}: {progress: number; renderedFrames: number}) => {
        sendRenderProgress(senderWindow, {
          jobId,
          status: 'rendering',
          progress,
          currentFrame: renderedFrames,
          totalFrames,
          outputPath,
        });
      },
    });

    renderJobs.delete(jobId);
    sendRenderProgress(senderWindow, {
      jobId,
      status: 'completed',
      progress: 1,
      currentFrame: totalFrames,
      totalFrames,
      outputPath,
    });
  } catch (error) {
    renderJobs.delete(jobId);
    const message = error instanceof Error ? error.message : 'Render failed.';
    const canceled = message.toLowerCase().includes('cancel');
    sendRenderProgress(senderWindow, {
      jobId,
      status: canceled ? 'canceled' : 'failed',
      progress: canceled ? 0 : undefined,
      currentFrame: 0,
      totalFrames,
      outputPath,
      error: message,
    });
  }
}
