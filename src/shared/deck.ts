import {z} from 'zod';

export const VIDEO_WIDTH = 1920;
export const VIDEO_HEIGHT = 1080;
export const FPS = 30;
export const READING_WPM = 145;
export const READING_PADDING_SECONDS = 5;
export const MIN_CONTENT_SECONDS = 18;
export const TITLE_SECONDS = 5;

export const PASSAGE_TITLES = {
  passage1: 'Khutbah 1',
  passage2: 'Khutbah 2',
} as const;

export const fontFamilyOptions = ['serif', 'sans', 'arabic', 'classic'] as const;

export type FontFamilyOption = (typeof fontFamilyOptions)[number];

export type DeckDesign = {
  fontFamily: FontFamilyOption;
  margin: number;
  verticalMargin: number;
  fontColor: string;
  backgroundColor: string;
  backgroundImage: string;
  fontSize: number;
  scrollingSpeed: number;
  contentLayout: 'single' | 'bilingual';
};

export const DEFAULT_DESIGN: DeckDesign = {
  fontFamily: 'serif',
  margin: 118,
  verticalMargin: 60,
  fontColor: '#f6efe1',
  backgroundColor: '#101312',
  backgroundImage: '',
  fontSize: 54,
  scrollingSpeed: READING_WPM,
  contentLayout: 'single',
};

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex color.');

export const deckDesignSchema = z.object({
  fontFamily: z.enum(fontFamilyOptions).default(DEFAULT_DESIGN.fontFamily),
  margin: z.number().min(0).max(200).default(DEFAULT_DESIGN.margin),
  verticalMargin: z.number().min(0).max(200).default(DEFAULT_DESIGN.verticalMargin),
  fontColor: hexColorSchema.default(DEFAULT_DESIGN.fontColor),
  backgroundColor: hexColorSchema.default(DEFAULT_DESIGN.backgroundColor),
  backgroundImage: z.string().default(DEFAULT_DESIGN.backgroundImage),
  fontSize: z.number().min(34).max(76).default(DEFAULT_DESIGN.fontSize),
  scrollingSpeed: z.number().min(80).max(240).default(DEFAULT_DESIGN.scrollingSpeed),
  contentLayout: z.enum(['single', 'bilingual']).default(DEFAULT_DESIGN.contentLayout),
});

export const deckSpecSchema = z.object({
  title: z.string().trim().min(1, 'Add a title.'),
  passage1: z.object({
    subtitle: z.string().trim().min(1, 'Add passage 1 subtitle.').default(PASSAGE_TITLES.passage1),
    content: z.string().trim().min(1, 'Add passage 1 content.'),
    contentSecondary: z.string().trim().default(''),
  }),
  passage2: z.object({
    subtitle: z.string().trim().min(1, 'Add passage 2 subtitle.').default(PASSAGE_TITLES.passage2),
    content: z.string().trim().min(1, 'Add passage 2 content.'),
    contentSecondary: z.string().trim().default(''),
  }),
  design: deckDesignSchema.default(DEFAULT_DESIGN),
});

export type DeckSpec = z.infer<typeof deckSpecSchema>;

export type SlideKind = 'title' | 'passage-title' | 'content';

export type SlidePlan = {
  id: 'main-title' | 'passage-1-title' | 'passage-1-content' | 'passage-2-title' | 'passage-2-content';
  kind: SlideKind;
  title?: string;
  content?: string;
  contentSecondary?: string;
  startFrame: number;
  durationInFrames: number;
};

export const defaultDeck: DeckSpec = {
  title: 'The Mercy of Allah',
  passage1: {
    subtitle: 'Khutbah 1',
    content:
      'All praise is due to Allah. We praise Him, seek His help, and ask His forgiveness.\n\nقال الله تعالى: فَاذْكُرُونِي أَذْكُرْكُمْ\n\nRemembering Allah softens the heart and returns a person to clarity after distraction.',
    contentSecondary: '',
  },
  passage2: {
    subtitle: 'Khutbah 2',
    content:
      'The believer carries worship into daily conduct: truthfulness in speech, patience in hardship, and mercy toward people.\n\nقال رسول الله ﷺ: إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ\n\nActions are raised by sincere intention, so renew the intention before every act.',
    contentSecondary: '',
  },
  design: DEFAULT_DESIGN,
};

export function parseDeckSpec(value: unknown): DeckSpec {
  return deckSpecSchema.parse(value);
}

export function countReadableWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return matches?.length ?? 0;
}

export function contentDurationSeconds(text: string, readingWpm = READING_WPM): number {
  const readingSeconds = Math.ceil((countReadableWords(text) / readingWpm) * 60);
  return Math.max(MIN_CONTENT_SECONDS, readingSeconds + READING_PADDING_SECONDS);
}

export function secondsToFrames(seconds: number): number {
  return Math.ceil(seconds * FPS);
}

export function buildSlidePlan(deck: DeckSpec): SlidePlan[] {
  const resolveDuration = (primary: string, secondary: string) => {
    if (deck.design.contentLayout === 'bilingual') {
      return Math.max(
        contentDurationSeconds(primary, deck.design.scrollingSpeed),
        contentDurationSeconds(secondary, deck.design.scrollingSpeed),
      );
    }
    return contentDurationSeconds(primary, deck.design.scrollingSpeed);
  };

  const slides: Omit<SlidePlan, 'startFrame'>[] = [
    {
      id: 'main-title',
      kind: 'title',
      title: deck.title,
      durationInFrames: secondsToFrames(TITLE_SECONDS),
    },
    {
      id: 'passage-1-title',
      kind: 'passage-title',
      title: deck.passage1.subtitle,
      durationInFrames: secondsToFrames(TITLE_SECONDS),
    },
    {
      id: 'passage-1-content',
      kind: 'content',
      content: deck.passage1.content,
      contentSecondary: deck.passage1.contentSecondary,
      durationInFrames: secondsToFrames(resolveDuration(deck.passage1.content, deck.passage1.contentSecondary)),
    },
    {
      id: 'passage-2-title',
      kind: 'passage-title',
      title: deck.passage2.subtitle,
      durationInFrames: secondsToFrames(TITLE_SECONDS),
    },
    {
      id: 'passage-2-content',
      kind: 'content',
      content: deck.passage2.content,
      contentSecondary: deck.passage2.contentSecondary,
      durationInFrames: secondsToFrames(resolveDuration(deck.passage2.content, deck.passage2.contentSecondary)),
    },
  ];

  let cursor = 0;
  return slides.map((slide) => {
    const planned = {...slide, startFrame: cursor};
    cursor += slide.durationInFrames;
    return planned;
  });
}

export function getTotalFrames(deck: DeckSpec): number {
  return buildSlidePlan(deck).reduce((total, slide) => total + slide.durationInFrames, 0);
}

export function getDeckDurationSeconds(deck: DeckSpec): number {
  return Math.ceil(getTotalFrames(deck) / FPS);
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

