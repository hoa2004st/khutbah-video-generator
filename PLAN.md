# Khutbah Slide-To-Video Desktop App

## Summary
Build a Windows-first desktop app using Electron, React, TypeScript, and Remotion. The app takes three user inputs: main title, passage 1 content, and passage 2 content. The two passage title slides are fixed as `Khutbah 1` and `Khutbah 2`.

The app generates a 5-slide animated presentation preview, exports a standalone `.html` presentation file, and renders a silent 16:9 1080p `.mp4` video.

## Key Changes
- Scaffold an Electron + Vite + React + TypeScript app.
- Use secure Electron defaults: local packaged content only, `nodeIntegration: false`, `contextIsolation: true`, preload-based IPC, and validated IPC senders.
- Define a shared deck schema with fixed passage titles and render options: `1920x1080`, `30fps`, `readingWpm: 145`.
- Build one shared presentation renderer used by the live preview, MP4 render, and exported standalone HTML.

## Presentation Behavior
- Exactly 5 slides: main title, `Khutbah 1`, passage 1 scrolling content, `Khutbah 2`, passage 2 scrolling content.
- Title slides use the same in/out motion pattern: enter from bottom to center, hold, exit upward with the same duration and easing.
- Content slides show only the passage text as a readable scrolling wall of text.
- Content duration is computed from text length: `ceil(wordCount / 145 * 60) + readingPaddingSeconds`, with a minimum duration for short passages.
- Mixed English and Arabic text uses paragraph-level `dir="auto"`, `white-space: pre-wrap`, and stable line-height.

## Build Sequence
1. Create the Electron/Vite/React shell with a form, preview panel, and export buttons.
2. Add deck validation, local autosave, and duration estimation.
3. Implement the Remotion composition and live preview for all five slides.
4. Add standalone `.html` export using the same deck spec, CSS, and timing constants.
5. Add MP4 rendering from Electron main process using Remotion `renderMedia()`, render progress, cancellation, and output-path selection.
6. Add packaging scripts and smoke tests for preview, HTML export, and MP4 render.

## Test Plan
- Unit tests for schema validation, word counting, duration calculation, and slide timeline generation.
- Mixed-language test case with English paragraphs and Arabic quote lines.
- Smoke render a short deck to MP4 and verify the file exists, is non-empty, and has `1920x1080` metadata.
- Export HTML and verify it opens without a dev server and contains the expected five-slide sequence.

## Assumptions
- First version is silent: no narration, background audio, or subtitles.
- First version targets landscape `1920x1080` MP4 only.
- Middle output is `.html`, not `.pptx`, because HTML/Remotion gives more deterministic animation and video rendering.
- Remotion is acceptable for this project; its license should be checked before commercial use by larger organizations.
