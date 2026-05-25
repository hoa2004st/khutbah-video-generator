import {app, BrowserWindow, dialog, ipcMain} from 'electron';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {existsSync, appendFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execSync} from 'node:child_process';

// Setup esbuild binaries before importing @remotion/bundler
function setupEsbuildBinaries() {
  const resourcesPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : app.getAppPath();
  const esbuildBinaryDir = path.join(resourcesPath, 'node_modules', '@esbuild', 'win32-x64');
  const esbuildCandidates = [
    path.join(esbuildBinaryDir, 'esbuild.exe'),
    path.join(esbuildBinaryDir, 'bin', 'esbuild.exe'),
  ];
  const esbuildExecutable = esbuildCandidates.find((candidate) => existsSync(candidate));

  if (esbuildExecutable) {
    process.env.ESBUILD_BINARY_PATH = esbuildExecutable;
  } else {
    console.error('Unable to locate esbuild.exe in', esbuildBinaryDir);
  }
}

const require = createRequire(import.meta.url);

function setupRemotionCompositorBinaries() {
  if (!app.isPackaged) {
    return;
  }

  const compositorDir = path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@remotion',
    'compositor-win32-x64-msvc',
  );

  if (!existsSync(compositorDir)) {
    console.error('Missing Remotion compositor binaries at', compositorDir);
    return;
  }

  try {
    const compositor = require('@remotion/compositor-win32-x64-msvc');
    compositor.dir = compositorDir;
  } catch (error) {
    console.error(
      'Failed to override Remotion compositor directory',
      error instanceof Error ? error.message : error,
    );
  }
}

// Setup logging to file for packaged mode
function setupLogging() {
  const logFile = path.join(app.getPath('userData'), 'app.log');
  const originalLog = console.log;
  const originalError = console.error;

  const writeLog = (level: string, args: unknown[]) => {
    const message = `[${new Date().toISOString()}] [${level}] ${args.map(arg => 
      typeof arg === 'string' ? arg : JSON.stringify(arg)
    ).join(' ')}\n`;
    
    try {
      appendFileSync(logFile, message);
    } catch (e) {
      // Ignore write errors
    }
    
    if (level === 'ERROR') {
      originalError(...args);
    } else {
      originalLog(...args);
    }
  };

  (console as any).log = (...args: unknown[]) => writeLog('INFO', args);
  (console as any).error = (...args: unknown[]) => writeLog('ERROR', args);
}

// Call before importing bundler
setupEsbuildBinaries();
setupRemotionCompositorBinaries();
setupLogging();

// Now safe to import @remotion modules
import {buildStandaloneHtml} from '../src/shared/htmlExport.js';
import {DeckSpec, FPS, VIDEO_HEIGHT, VIDEO_WIDTH, getTotalFrames, parseDeckSpec} from '../src/shared/deck.js';

type RenderJobState = {
  cancel: () => void;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const renderJobs = new Map<string, RenderJobState>();
type RemotionModules = {
  bundle: typeof import('@remotion/bundler').bundle;
  getCompositions: typeof import('@remotion/renderer').getCompositions;
  makeCancelSignal: typeof import('@remotion/renderer').makeCancelSignal;
  renderMedia: typeof import('@remotion/renderer').renderMedia;
};
type CancelSignal = ReturnType<RemotionModules['makeCancelSignal']>;
let remotionModulesPromise: Promise<RemotionModules> | null = null;

async function loadRemotionModules(): Promise<RemotionModules> {
  if (!remotionModulesPromise) {
    remotionModulesPromise = (async () => {
      const bundler = await import('@remotion/bundler');
      const renderer = await import('@remotion/renderer');
      return {
        bundle: bundler.bundle,
        getCompositions: renderer.getCompositions,
        makeCancelSignal: renderer.makeCancelSignal,
        renderMedia: renderer.renderMedia,
      };
    })();
  }

  return remotionModulesPromise;
}

function isDev() {
  return !app.isPackaged;
}

function getAppRoot() {
  return app.getAppPath();
}

function getResourcesRoot() {
  // In packaged mode, everything is at getAppPath()
  // (dist, dist-electron, etc are all at the root level in the asar)
  // In dev mode, same thing
  return getAppRoot();
}

function getRenderEntryPoint() {
  return path.join(getAppRoot(), 'src', 'remotion', 'render-entry.tsx');
}

function getRemotionRoot() {
  if (app.isPackaged) {
    // Remotion's bundler chdirs to rootDir; app.asar is a file, so use a real directory.
    return path.dirname(getAppRoot());
  }

  return getAppRoot();
}

function getCompositorBinariesDirectory() {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@remotion', 'compositor-win32-x64-msvc')
    : path.join(getAppRoot(), 'node_modules', '@remotion', 'compositor-win32-x64-msvc');

  if (existsSync(base)) {
    return base;
  }

  console.error('Missing Remotion compositor binaries at', base);
  return null;
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
    show: false,
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
    const indexPath = path.join(getAppRoot(), 'dist', 'index.html');
    const fileUrl = `file://${indexPath}`;
    
    console.log('App path:', getAppRoot());
    console.log('Loading index from:', indexPath);
    console.log('File URL:', fileUrl);
    console.log('File exists:', existsSync(indexPath));
    
    try {
      await mainWindow.loadFile(indexPath);
    } catch (error) {
      console.error('Failed to load file:', error);
      mainWindow.loadURL(fileUrl);
    }
  }

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });

  mainWindow.show();
  console.log('Window created and shown');
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
    const {makeCancelSignal} = await loadRemotionModules();
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
  cancelSignal: CancelSignal;
}) {
  const {bundle, getCompositions, renderMedia} = await loadRemotionModules();
  const serveUrl = await bundle({
    entryPoint: getRenderEntryPoint(),
    rootDir: getRemotionRoot(),
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
    const binariesDirectory = getCompositorBinariesDirectory();
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
      binariesDirectory,
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
