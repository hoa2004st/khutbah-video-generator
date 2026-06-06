// Standalone Remotion render profiler.
// Runs the SAME pipeline as electron/main.ts (bundle -> getCompositions -> renderMedia)
// outside Electron, with phase timing + peak temp-dir disk sampling.
//
// Usage:
//   node scripts/profile-render.mjs <minutes> <mode>
//   mode = "current"  -> concurrency 2 + disallowParallelEncoding:true  (the long/balanced path)
//   mode = "parallel" -> concurrency 2 + streaming encode (parallel)
//   mode = "default"  -> Remotion defaults
//
// It samples the temp dir every 400ms to capture peak on-disk frame buffer.

import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const minutes = Number(process.argv[2] ?? 2);
const mode = process.argv[3] ?? 'current';

// --- wire up binaries exactly like main.ts ---
const esbuildExe = path.join(repoRoot, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe');
if (fs.existsSync(esbuildExe)) process.env.ESBUILD_BINARY_PATH = esbuildExe;
const compositorDir = path.join(repoRoot, 'node_modules', '@remotion', 'compositor-win32-x64-msvc');

// --- dedicate a temp dir we can measure (mirrors prepareRenderTempDirectory) ---
const outDir = path.join(repoRoot, '.profile-out');
fs.mkdirSync(outDir, {recursive: true});
const tempRoot = path.join(outDir, '.render-temp');
fs.rmSync(tempRoot, {recursive: true, force: true});
fs.mkdirSync(tempRoot, {recursive: true});
process.env.TEMP = tempRoot;
process.env.TMP = tempRoot;
process.env.TMPDIR = tempRoot;

const VIDEO_WIDTH = 1920;
const VIDEO_HEIGHT = 1080;
const FPS = 30;
const totalFrames = Math.round(minutes * 60 * FPS);

// Build content long enough that slides actually fill the duration (~145 wpm).
function makeContent(words) {
  const base =
    'All praise is due to Allah, the Lord of all worlds, the Most Merciful. ' +
    'قال الله تعالى فاذكروني أذكركم واشكروا لي ولا تكفرون. ' +
    'The believer carries worship into daily conduct truthfulness patience and mercy toward people. ';
  let out = '';
  while (out.split(/\s+/).length < words) out += base;
  // break into paragraphs
  return out.replace(/(All praise)/g, '\n\n$1').trim();
}
const wordsPerPassage = Math.round((minutes * 60 * 145) / 2);
const deck = {
  title: 'Profiling Render',
  passage1: {subtitle: 'Khutbah 1', content: makeContent(wordsPerPassage), contentSecondary: ''},
  passage2: {subtitle: 'Khutbah 2', content: makeContent(wordsPerPassage), contentSecondary: ''},
  design: {
    fontFamily: 'serif', margin: 118, verticalMargin: 60,
    fontColor: '#f6efe1', backgroundColor: '#101312', backgroundImage: '',
    fontSize: 54, scrollingSpeed: 145, contentLayout: 'single',
  },
  render: {quality: 'balanced'},
};

const tunings = {
  current: {imageFormat: 'jpeg', jpegQuality: 90, concurrency: 2, disallowParallelEncoding: true},
  parallel: {imageFormat: 'jpeg', jpegQuality: 90, concurrency: 2},
  fixed: {imageFormat: 'jpeg', jpegQuality: 80, concurrency: 4, x264Preset: 'faster'},
  conc1: {imageFormat: 'jpeg', jpegQuality: 80, concurrency: 1},
  default: {},
};
const tuning = tunings[mode] ?? tunings.current;

// Optional knobs: arg4 = GL backend (angle|swiftshader|egl|swangle), arg5 = scale.
const gl = process.argv[4];
const scaleArg = process.argv[5] ? Number(process.argv[5]) : undefined;
const chromiumOptions = gl ? {gl} : undefined;

async function dirSize(dir) {
  let total = 0;
  let stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = await fsp.readdir(d, {withFileTypes: true}); } catch { continue; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else { try { total += (await fsp.stat(full)).size; } catch {} }
    }
  }
  return total;
}

const GB = 1e9, MB = 1e6;
function now() { return Number(process.hrtime.bigint() / 1000000n); }

async function main() {
  console.log(`\n=== PROFILE: ${minutes} min (${totalFrames} frames @ ${FPS}fps), mode=${mode} ===`);
  console.log(`cpus=${os.cpus().length} freeRAM=${(os.freemem()/GB).toFixed(1)}GB tuning=${JSON.stringify(tuning)}`);
  console.log(`gl=${gl ?? '(default)'} scale=${scaleArg ?? 1}\n`);

  const {bundle} = await import('@remotion/bundler');
  const {getCompositions, renderMedia} = await import('@remotion/renderer');

  let t = now();
  const serveUrl = await bundle({
    entryPoint: path.join(repoRoot, 'src', 'remotion', 'render-entry.tsx'),
    rootDir: repoRoot,
  });
  const bundleMs = now() - t;
  console.log(`[phase] bundle:          ${(bundleMs/1000).toFixed(1)}s`);

  t = now();
  const comps = await getCompositions(serveUrl, {inputProps: {deck}});
  const comp = comps.find((c) => c.id === 'KhutbahDeck');
  const compMs = now() - t;
  console.log(`[phase] getCompositions: ${(compMs/1000).toFixed(1)}s`);
  if (!comp) throw new Error('KhutbahDeck composition not found');

  // sample temp dir peak
  let peakBytes = 0;
  let lastFrame = 0, lastTime = now(), renderStart = now();
  const sampler = setInterval(async () => {
    const s = await dirSize(tempRoot);
    if (s > peakBytes) peakBytes = s;
  }, 400);

  t = now();
  await renderMedia({
    composition: {...comp, durationInFrames: totalFrames, fps: FPS, width: VIDEO_WIDTH, height: VIDEO_HEIGHT},
    serveUrl,
    codec: 'h264',
    outputLocation: path.join(outDir, `profile-${mode}.mp4`),
    inputProps: {deck},
    binariesDirectory: fs.existsSync(compositorDir) ? compositorDir : null,
    ...(chromiumOptions ? {chromiumOptions} : {}),
    ...(scaleArg ? {scale: scaleArg} : {}),
    onProgress: ({progress, renderedFrames, encodedFrames, stitchStage}) => {
      const tn = now();
      if (renderedFrames - lastFrame >= FPS) {
        const fps = (renderedFrames - lastFrame) / ((tn - lastTime) / 1000);
        process.stdout.write(
          `\r  render ${(progress*100).toFixed(0)}%  rendered=${renderedFrames} encoded=${encodedFrames ?? 0} ` +
          `stage=${stitchStage ?? '-'}  ${fps.toFixed(1)} fps  peakDisk=${(peakBytes/GB).toFixed(2)}GB   `);
        lastFrame = renderedFrames; lastTime = tn;
      }
    },
    ...tuning,
  });
  const renderMs = now() - t;
  clearInterval(sampler);
  const finalPeak = Math.max(peakBytes, await dirSize(tempRoot));

  const wallS = (bundleMs + compMs + renderMs) / 1000;
  console.log(`\n\n[phase] renderMedia:     ${(renderMs/1000).toFixed(1)}s`);
  console.log(`\n--- SUMMARY (${mode}) ---`);
  console.log(`total wall:        ${wallS.toFixed(1)}s for ${minutes}min video  (realtime ratio = ${(wallS/(minutes*60)).toFixed(2)}x)`);
  console.log(`avg render fps:    ${(totalFrames/(renderMs/1000)).toFixed(1)} fps`);
  console.log(`peak temp disk:    ${(finalPeak/GB).toFixed(2)} GB  (${(finalPeak/MB/totalFrames).toFixed(2)} MB/frame)`);
  const est30 = (finalPeak/MB/totalFrames) * 30 * 60 * FPS / 1000;
  console.log(`==> extrapolated peak disk for 30-min video: ${est30.toFixed(1)} GB`);

  fs.rmSync(tempRoot, {recursive: true, force: true});
}

main().catch((e) => { console.error('\nPROFILER ERROR:', e); process.exit(1); });
