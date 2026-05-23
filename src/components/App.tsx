import React, {useEffect, useMemo, useState} from 'react';
import {Player} from '@remotion/player';
import {KhutbahComposition} from '../remotion/KhutbahComposition';
import {
  DEFAULT_DESIGN,
  DeckDesign,
  DeckSpec,
  FPS,
  PASSAGE_TITLES,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  buildSlidePlan,
  countReadableWords,
  defaultDeck,
  fontFamilyOptions,
  getDeckDurationSeconds,
  getTotalFrames,
  parseDeckSpec,
} from '../shared/deck';
import {buildStandaloneHtml} from '../shared/htmlExport';
import type {RenderProgress} from '../global';

const STORAGE_KEY = 'khutbah-video-generator.deck.v1';

const fontLabels: Record<DeckDesign['fontFamily'], string> = {
  serif: 'Serif',
  sans: 'Sans',
  arabic: 'Arabic focused',
  classic: 'Classic',
};

type SaveState = {
  tone: 'idle' | 'busy' | 'success' | 'error';
  message: string;
};

function loadDeck(): DeckSpec {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultDeck;
    }
    return parseDeckSpec(JSON.parse(raw));
  } catch {
    return defaultDeck;
  }
}

export function App() {
  const [deck, setDeck] = useState<DeckSpec>(() => loadDeck());
  const [saveState, setSaveState] = useState<SaveState>({
    tone: 'idle',
    message: 'Ready',
  });
  const [renderProgress, setRenderProgress] = useState<RenderProgress | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const validDeck = deck;
  const totalFrames = useMemo(() => getTotalFrames(validDeck), [validDeck]);
  const durationSeconds = useMemo(() => getDeckDurationSeconds(validDeck), [validDeck]);
  const slidePlan = useMemo(() => buildSlidePlan(validDeck), [validDeck]);
  const passage1Words = countReadableWords(deck.passage1.content);
  const passage2Words = countReadableWords(deck.passage2.content);
  const apiAvailable = Boolean(window.khutbahApi);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(deck));
  }, [deck]);

  useEffect(() => {
    if (!window.khutbahApi) {
      return undefined;
    }
    return window.khutbahApi.onRenderProgress((progress) => {
      setRenderProgress(progress);
      if (progress.status === 'completed' || progress.status === 'failed' || progress.status === 'canceled') {
        setActiveJobId(null);
        setSaveState({
          tone: progress.status === 'completed' ? 'success' : progress.status === 'failed' ? 'error' : 'idle',
          message:
            progress.status === 'completed'
              ? `Rendered MP4: ${progress.outputPath}`
              : progress.error ?? `Render ${progress.status}.`,
        });
      }
    });
  }, []);

  const updateDeck = (next: Partial<DeckSpec>) => {
    setDeck((current) => ({...current, ...next}));
  };

  const updatePassage = (key: 'passage1' | 'passage2', content: string) => {
    setDeck((current) => ({
      ...current,
      [key]: {...current[key], content},
    }));
  };

  const updateDesign = <Key extends keyof DeckDesign>(key: Key, value: DeckDesign[Key]) => {
    setDeck((current) => ({
      ...current,
      design: {
        ...current.design,
        [key]: value,
      },
    }));
  };

  const resetDesign = () => {
    setDeck((current) => ({
      ...current,
      design: DEFAULT_DESIGN,
    }));
  };

  const importBackground = (file: File | null) => {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        updateDesign('backgroundImage', reader.result);
      }
    };
    reader.onerror = () => {
      setSaveState({tone: 'error', message: 'Could not import background image.'});
    };
    reader.readAsDataURL(file);
  };

  const exportHtml = async () => {
    setSaveState({tone: 'busy', message: 'Preparing HTML export...'});
    try {
      parseDeckSpec(validDeck);
      const html = buildStandaloneHtml(validDeck);
      if (window.khutbahApi) {
        const outputPath = await window.khutbahApi.chooseOutput('html');
        if (!outputPath) {
          setSaveState({tone: 'idle', message: 'HTML export canceled.'});
          return;
        }
        const result = await window.khutbahApi.exportHtml(validDeck, outputPath);
        setSaveState({tone: 'success', message: `Exported HTML: ${result.outputPath}`});
        return;
      }

      const blob = new Blob([html], {type: 'text/html'});
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'khutbah-deck.html';
      anchor.click();
      URL.revokeObjectURL(url);
      setSaveState({tone: 'success', message: 'Downloaded HTML export.'});
    } catch (error) {
      setSaveState({tone: 'error', message: error instanceof Error ? error.message : 'HTML export failed.'});
    }
  };

  const renderMp4 = async () => {
    if (!window.khutbahApi) {
      setSaveState({tone: 'error', message: 'MP4 rendering is available in the Electron app.'});
      return;
    }

    try {
      parseDeckSpec(validDeck);
    } catch (error) {
      setSaveState({tone: 'error', message: error instanceof Error ? error.message : 'Deck validation failed.'});
      return;
    }

    setSaveState({tone: 'busy', message: 'Choosing MP4 output path...'});
    const outputPath = await window.khutbahApi.chooseOutput('mp4');
    if (!outputPath) {
      setSaveState({tone: 'idle', message: 'MP4 render canceled.'});
      return;
    }

    setRenderProgress({
      jobId: 'pending',
      status: 'queued',
      progress: 0,
      currentFrame: 0,
      totalFrames,
      outputPath,
    });
    setSaveState({tone: 'busy', message: 'Starting MP4 render...'});
    try {
      const job = await window.khutbahApi.startRender(validDeck, outputPath);
      setActiveJobId(job.jobId);
      setSaveState({tone: 'busy', message: `Rendering MP4: ${job.outputPath}`});
    } catch (error) {
      setActiveJobId(null);
      setSaveState({tone: 'error', message: error instanceof Error ? error.message : 'MP4 render failed to start.'});
    }
  };

  const cancelRender = async () => {
    if (activeJobId && window.khutbahApi) {
      await window.khutbahApi.cancelRender(activeJobId);
    }
  };

  return (
    <main className="app-shell">
      <section className="workspace">
        <aside className="editor-panel">
          <div className="brand-row">
            <div>
              <p className="eyebrow">Khutbah Studio</p>
              <h1>Slide to video</h1>
            </div>
            <span className="format-pill">1080p</span>
          </div>

          <label className="field">
            <span>Title</span>
            <input
              value={deck.title}
              onChange={(event) => updateDeck({title: event.target.value})}
              placeholder="Main khutbah title"
            />
          </label>

          <label className="field field-tall">
            <span>Passage 1 title</span>
            <input
              value={deck.passage1.subtitle}
              onChange={(event) => setDeck((current) => ({
                ...current,
                passage1: {...current.passage1, subtitle: event.target.value},
              }))}
              placeholder="Passage 1 title"
            />
          </label>

          <label className="field field-tall">
            <span>Passage 1 content</span>
            <textarea
              value={deck.passage1.content}
              onChange={(event) => updatePassage('passage1', event.target.value)}
              placeholder="Paste the first passage..."
            />
          </label>

          <label className="field field-tall">
            <span>Passage 2 title</span>
            <input
              value={deck.passage2.subtitle}
              onChange={(event) => setDeck((current) => ({
                ...current,
                passage2: {...current.passage2, subtitle: event.target.value},
              }))}
              placeholder="Passage 2 title"
            />
          </label>

          <label className="field field-tall">
            <span>Passage 2 content</span>
            <textarea
              value={deck.passage2.content}
              onChange={(event) => updatePassage('passage2', event.target.value)}
              placeholder="Paste the second passage..."
            />
          </label>

          <section className="design-panel" aria-label="Design options">
            <div className="section-row">
              <div>
                <p className="eyebrow">Design</p>
                <h2>Slide options</h2>
              </div>
              <button type="button" className="small-button" onClick={resetDesign}>
                Reset
              </button>
            </div>

            <label className="field">
              <span>Font</span>
              <select
                value={deck.design.fontFamily}
                onChange={(event) => updateDesign('fontFamily', event.target.value as DeckDesign['fontFamily'])}
              >
                {fontFamilyOptions.map((font) => (
                  <option key={font} value={font}>
                    {fontLabels[font]}
                  </option>
                ))}
              </select>
            </label>

            <div className="color-grid">
              <label className="field color-field">
                <span>Font colour</span>
                <input
                  type="color"
                  value={deck.design.fontColor}
                  onChange={(event) => updateDesign('fontColor', event.target.value)}
                />
              </label>
              <label className="field color-field">
                <span>Background</span>
                <input
                  type="color"
                  value={deck.design.backgroundColor}
                  onChange={(event) => updateDesign('backgroundColor', event.target.value)}
                />
              </label>
            </div>

            <div className="background-import">
              <label className="file-button">
                Import background
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => importBackground(event.target.files?.[0] ?? null)}
                />
              </label>
              <button
                type="button"
                className="small-button"
                onClick={() => updateDesign('backgroundImage', '')}
                disabled={!deck.design.backgroundImage}
              >
                Clear image
              </button>
              <span>{deck.design.backgroundImage ? 'Image background active' : 'Solid colour background'}</span>
            </div>

            <RangeField
              label="Horizontal margin"
              value={deck.design.margin}
              min={0}
              max={200}
              step={2}
              unit="px"
              onChange={(value) => updateDesign('margin', value)}
            />
            <RangeField
              label="Vertical margin"
              value={deck.design.verticalMargin}
              min={0}
              max={200}
              step={2}
              unit="px"
              onChange={(value) => updateDesign('verticalMargin', value)}
            />
            <RangeField
              label="Font size"
              value={deck.design.fontSize}
              min={34}
              max={76}
              step={1}
              unit="px"
              onChange={(value) => updateDesign('fontSize', value)}
            />
            <RangeField
              label="Scrolling speed"
              value={deck.design.scrollingSpeed}
              min={80}
              max={240}
              step={5}
              unit="wpm"
              onChange={(value) => updateDesign('scrollingSpeed', value)}
            />
          </section>

          <div className="stats-grid">
            <Stat label="Duration" value={`${durationSeconds}s`} />
            <Stat label="Slides" value="5" />
            <Stat label="Words 1" value={String(passage1Words)} />
            <Stat label="Words 2" value={String(passage2Words)} />
          </div>

          <div className="actions">
            <button type="button" onClick={exportHtml} disabled={saveState.tone === 'busy'}>
              Export HTML
            </button>
            <button
              className="primary-action"
              type="button"
              onClick={renderMp4}
              disabled={saveState.tone === 'busy' || !apiAvailable}
              title={apiAvailable ? 'Render MP4' : 'Run inside Electron to render MP4'}
            >
              Render MP4
            </button>
            {activeJobId ? (
              <button type="button" className="ghost-action" onClick={cancelRender}>
                Cancel
              </button>
            ) : null}
          </div>

          <Status state={saveState} progress={renderProgress} />
        </aside>

        <section className="preview-panel">
          <div className="preview-header">
            <div>
              <p className="eyebrow">Live preview</p>
              <h2>{deck.title || 'Untitled khutbah'}</h2>
            </div>
            <div className="timeline-summary">
              {slidePlan.map((slide) => (
                <span key={slide.id} title={`${slide.id}: ${Math.round(slide.durationInFrames / FPS)}s`} />
              ))}
            </div>
          </div>

          <div className="player-frame">
            <Player
              key={totalFrames}
              component={KhutbahComposition}
              inputProps={{deck: validDeck}}
              durationInFrames={totalFrames}
              fps={FPS}
              compositionWidth={VIDEO_WIDTH}
              compositionHeight={VIDEO_HEIGHT}
              controls
              loop
              style={{width: '100%', aspectRatio: `${VIDEO_WIDTH} / ${VIDEO_HEIGHT}`}}
            />
          </div>
        </section>
      </section>
    </main>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field range-field">
      <span>
        {label}
        <strong>
          {value}
          {unit}
        </strong>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function Stat({label, value}: {label: string; value: string}) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Status({state, progress}: {state: SaveState; progress: RenderProgress | null}) {
  const percent = progress ? Math.round(progress.progress * 100) : 0;
  return (
    <div className={`status-box status-${state.tone}`}>
      <p>{state.message}</p>
      {progress && progress.status === 'rendering' ? (
        <div className="progress-track" aria-label={`Render progress ${percent}%`}>
          <span style={{width: `${percent}%`}} />
        </div>
      ) : null}
    </div>
  );
}
