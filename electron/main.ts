import {app, BrowserWindow, dialog, ipcMain, powerSaveBlocker} from 'electron';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {existsSync, appendFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execSync, execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

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
import {
  DeckSpec,
  FPS,
  RenderQualityOption,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  getTotalFrames,
  parseDeckSpec,
} from '../src/shared/deck.js';

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
let renderPowerBlockerId: number | null = null;
// Render long videos in segments so the on-disk frame buffer never grows with
// total duration. Each segment is encoded to its own mp4, then concatenated
// losslessly. 3 minutes keeps peak temp disk ~1 GB even on low-storage machines.
const CHUNK_FRAMES = 3 * 60 * FPS;

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

function startRenderPowerSaveBlocker() {
  if (renderPowerBlockerId !== null && powerSaveBlocker.isStarted(renderPowerBlockerId)) {
    return;
  }
  renderPowerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
}

function stopRenderPowerSaveBlocker() {
  if (renderPowerBlockerId === null) {
    return;
  }
  if (powerSaveBlocker.isStarted(renderPowerBlockerId)) {
    powerSaveBlocker.stop(renderPowerBlockerId);
  }
  renderPowerBlockerId = null;
}

type TempEnvSnapshot = {
  TEMP?: string;
  TMP?: string;
  TMPDIR?: string;
};

async function prepareRenderTempDirectory(outputPath: string) {
  const outputDir = path.dirname(outputPath);
  const tempRoot = path.join(outputDir, '.khutbah-render-temp');
  const previousEnv: TempEnvSnapshot = {
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    TMPDIR: process.env.TMPDIR,
  };
  let tempDirReady = false;

  try {
    await fs.mkdir(tempRoot, {recursive: true});
    tempDirReady = true;
  } catch (error) {
    console.error('Failed to create render temp directory:', error);
  }

  if (tempDirReady) {
    process.env.TEMP = tempRoot;
    process.env.TMP = tempRoot;
    process.env.TMPDIR = tempRoot;
  }

  const restoreEnv = () => {
    if (previousEnv.TEMP === undefined) {
      delete process.env.TEMP;
    } else {
      process.env.TEMP = previousEnv.TEMP;
    }
    if (previousEnv.TMP === undefined) {
      delete process.env.TMP;
    } else {
      process.env.TMP = previousEnv.TMP;
    }
    if (previousEnv.TMPDIR === undefined) {
      delete process.env.TMPDIR;
    } else {
      process.env.TMPDIR = previousEnv.TMPDIR;
    }
  };

  const cleanupTempDir = async () => {
    if (!tempDirReady) {
      return;
    }
    try {
      await fs.rm(tempRoot, {recursive: true, force: true});
    } catch (error) {
      console.error('Failed to clean render temp directory:', error);
    }
  };

  const tempDrive = path.parse(tempRoot).root.toLowerCase();
  const outputDrive = path.parse(outputPath).root.toLowerCase();
  if (tempDrive !== outputDrive) {
    console.warn(
      'Render temp directory is on a different drive than the output path. Temp:',
      tempDrive,
      'Output:',
      outputDrive,
    );
  }

  return {restoreEnv, cleanupTempDir, tempRoot, tempDirReady};
}

function getRenderConcurrency(): number {
  // Profiling showed concurrency 2 left the machine idle (2.9 fps) while 4 hit
  // ~8-10 fps. Cap at 4 to avoid exhausting RAM with too many Chromium tabs.
  return Math.max(1, Math.min(os.cpus().length, 4));
}

function getRenderTuning(quality: RenderQualityOption) {
  const concurrency = getRenderConcurrency();
  if (quality === 'fast') {
    return {
      imageFormat: 'jpeg' as const,
      jpegQuality: 85,
      x264Preset: 'veryfast' as const,
      crf: 23,
      hardwareAcceleration: 'if-possible' as const,
      concurrency,
    };
  }
  if (quality === 'draft') {
    return {
      imageFormat: 'jpeg' as const,
      jpegQuality: 75,
      x264Preset: 'ultrafast' as const,
      crf: 28,
      hardwareAcceleration: 'if-possible' as const,
      scale: 0.75,
      concurrency,
    };
  }
  // balanced: stream frames to the encoder (never retain all frames on disk)
  // and use all available cores.
  return {
    imageFormat: 'jpeg' as const,
    jpegQuality: 82,
    x264Preset: 'faster' as const,
    hardwareAcceleration: 'if-possible' as const,
    concurrency,
  };
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

type RemotionComposition = Awaited<ReturnType<RemotionModules['getCompositions']>>[number];

// Concatenate h264 mp4 segments losslessly (no re-encode) with the bundled ffmpeg.
async function concatSegments(
  ffmpegPath: string,
  segmentPaths: string[],
  outputPath: string,
  tempRoot: string,
) {
  const listFile = path.join(tempRoot, 'segments.txt');
  // ffmpeg's concat demuxer wants forward slashes, even on Windows.
  const listBody = segmentPaths
    .map((segment) => `file '${segment.replace(/\\/g, '/')}'`)
    .join('\n');
  await fs.writeFile(listFile, listBody, 'utf8');
  await execFileAsync(ffmpegPath, [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listFile,
    '-c', 'copy',
    '-movflags', '+faststart',
    outputPath,
  ]);
}

// Render to outputPath. Long videos are rendered in CHUNK_FRAMES segments so the
// on-disk frame buffer stays bounded regardless of total duration, then the
// segments are concatenated. onFrame receives the absolute frame index.
async function renderDeckVideo({
  renderMedia,
  baseComposition,
  serveUrl,
  deck,
  totalFrames,
  outputPath,
  tempRoot,
  binariesDirectory,
  cancelSignal,
  renderTuning,
  onFrame,
}: {
  renderMedia: RemotionModules['renderMedia'];
  baseComposition: RemotionComposition;
  serveUrl: string;
  deck: DeckSpec;
  totalFrames: number;
  outputPath: string;
  tempRoot: string;
  binariesDirectory: string | null;
  cancelSignal: CancelSignal;
  renderTuning: ReturnType<typeof getRenderTuning>;
  onFrame: (absoluteFrame: number) => void;
}) {
  const renderOne = (
    outputLocation: string,
    frameRange: [number, number] | null,
    frameOffset: number,
  ) =>
    renderMedia({
      composition: baseComposition,
      serveUrl,
      codec: 'h264',
      outputLocation,
      inputProps: {deck},
      binariesDirectory,
      cancelSignal: cancelSignal.cancelSignal,
      ...(frameRange ? {frameRange} : {}),
      onProgress: ({renderedFrames}: {renderedFrames: number}) =>
        onFrame(frameOffset + renderedFrames),
      ...renderTuning,
    });

  const ffmpegPath = binariesDirectory ? path.join(binariesDirectory, 'ffmpeg.exe') : null;

  // Single render when short, or if we can't find ffmpeg to stitch segments.
  if (totalFrames <= CHUNK_FRAMES || !ffmpegPath || !existsSync(ffmpegPath)) {
    if (totalFrames > CHUNK_FRAMES && (!ffmpegPath || !existsSync(ffmpegPath))) {
      console.warn('ffmpeg.exe not found; rendering long video without chunking:', ffmpegPath);
    }
    await renderOne(outputPath, null, 0);
    return;
  }

  const chunkCount = Math.ceil(totalFrames / CHUNK_FRAMES);
  const segmentPaths: string[] = [];
  for (let i = 0; i < chunkCount; i += 1) {
    const start = i * CHUNK_FRAMES;
    const end = Math.min(start + CHUNK_FRAMES - 1, totalFrames - 1);
    const segmentPath = path.join(tempRoot, `segment-${String(i).padStart(4, '0')}.mp4`);
    segmentPaths.push(segmentPath);
    await renderOne(segmentPath, [start, end], start);
  }

  await concatSegments(ffmpegPath, segmentPaths, outputPath, tempRoot);
  await Promise.all(segmentPaths.map((segment) => fs.rm(segment, {force: true})));
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
    const {restoreEnv, cleanupTempDir, tempRoot} = await prepareRenderTempDirectory(outputPath);
    startRenderPowerSaveBlocker();
    const renderTuning = getRenderTuning(deck.render.quality);
    const binariesDirectory = getCompositorBinariesDirectory();
    try {
      await renderDeckVideo({
        renderMedia,
        baseComposition: {
          ...composition,
          durationInFrames: totalFrames,
          fps: FPS,
          width: VIDEO_WIDTH,
          height: VIDEO_HEIGHT,
        },
        serveUrl,
        deck,
        totalFrames,
        outputPath,
        tempRoot,
        binariesDirectory,
        cancelSignal,
        renderTuning,
        onFrame: (absoluteFrame) => {
          sendRenderProgress(senderWindow, {
            jobId,
            status: 'rendering',
            progress: totalFrames > 0 ? absoluteFrame / totalFrames : 0,
            currentFrame: absoluteFrame,
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
    } finally {
      stopRenderPowerSaveBlocker();
      restoreEnv();
      await cleanupTempDir();
    }
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
