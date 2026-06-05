import type {DeckSpec} from './shared/deck';

export type ExportResult = {
  outputPath: string;
};

export type RenderJob = {
  jobId: string;
  outputPath: string;
};

// 'remotion' = frame-accurate offline render; 'capture' = real-time screen
// capture of the HTML deck (faster on low-core machines, quality varies).
export type RenderMethod = 'remotion' | 'capture';

export type RenderProgress = {
  jobId: string;
  status: 'queued' | 'rendering' | 'completed' | 'failed' | 'canceled';
  progress: number;
  currentFrame: number;
  totalFrames: number;
  outputPath?: string;
  error?: string;
};

declare global {
  interface Window {
    khutbahApi?: {
      chooseOutput: (kind: 'html' | 'mp4') => Promise<string | null>;
      exportHtml: (deck: DeckSpec, outputPath: string) => Promise<ExportResult>;
      startRender: (deck: DeckSpec, outputPath: string, method?: RenderMethod) => Promise<RenderJob>;
      cancelRender: (jobId: string) => Promise<void>;
      onRenderProgress: (listener: (progress: RenderProgress) => void) => () => void;
    };
  }
}
