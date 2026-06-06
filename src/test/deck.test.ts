import {describe, expect, it} from 'vitest';
import {
  DEFAULT_DESIGN,
  DEFAULT_RENDER,
  FPS,
  PASSAGE_TITLES,
  TITLE_SECONDS,
  buildSlidePlan,
  contentDurationSeconds,
  countReadableWords,
  defaultDeck,
  getTotalFrames,
  parseDeckSpec,
} from '../shared/deck';
import {buildStandaloneHtml} from '../shared/htmlExport';

describe('deck model', () => {
  it('uses fixed passage titles in the slide sequence', () => {
    const slides = buildSlidePlan(defaultDeck);

    expect(slides).toHaveLength(5);
    expect(slides[1].title).toBe(PASSAGE_TITLES.passage1);
    expect(slides[3].title).toBe(PASSAGE_TITLES.passage2);
  });

  it('counts English and Arabic text as readable words', () => {
    expect(countReadableWords('mercy patience قال الله تعالى')).toBe(5);
  });

  it('keeps title slides at the configured duration', () => {
    const slides = buildSlidePlan(defaultDeck);

    expect(slides[0].durationInFrames).toBe(TITLE_SECONDS * FPS);
    expect(slides[1].startFrame).toBe(TITLE_SECONDS * FPS);
    expect(getTotalFrames(defaultDeck)).toBeGreaterThan(TITLE_SECONDS * FPS * 3);
  });

  it('gives short content a readable minimum duration', () => {
    expect(contentDurationSeconds('short passage')).toBeGreaterThan(10);
  });

  it('validates required user inputs', () => {
    expect(() =>
      parseDeckSpec({
        title: '',
        passage1: {content: 'one'},
        passage2: {content: 'two'},
      }),
    ).toThrow();
  });

  it('adds default design settings when loading older deck data', () => {
    const deck = parseDeckSpec({
      title: 'Older deck',
      passage1: {content: 'one'},
      passage2: {content: 'two'},
    });

    expect(deck.design).toEqual(DEFAULT_DESIGN);
  });

  it('adds default render settings when loading older deck data', () => {
    const deck = parseDeckSpec({
      title: 'Render deck',
      passage1: {content: 'one'},
      passage2: {content: 'two'},
    });

    expect(deck.render).toEqual(DEFAULT_RENDER);
  });

  it('keeps imported background image data in the design settings', () => {
    const deck = parseDeckSpec({
      title: 'Background deck',
      passage1: {content: 'one'},
      passage2: {content: 'two'},
      design: {
        ...DEFAULT_DESIGN,
        backgroundImage: 'data:image/png;base64,abc123',
      },
    });

    expect(deck.design.backgroundImage).toBe('data:image/png;base64,abc123');
  });

  it('uses scrolling speed to change content duration', () => {
    const passage = Array.from({length: 120}, (_, index) => `word${index}`).join(' ');
    const slow = contentDurationSeconds(passage, 80);
    const fast = contentDurationSeconds(passage, 240);

    expect(slow).toBeGreaterThan(fast);
  });
});

describe('standalone html export', () => {
  it('contains all five slide surfaces and fixed passage titles', () => {
    const html = buildStandaloneHtml(defaultDeck);

    expect(html.match(/class="slide/g)).toHaveLength(5);
    expect(html).toContain(PASSAGE_TITLES.passage1);
    expect(html).toContain(PASSAGE_TITLES.passage2);
    expect(html).toContain(defaultDeck.title);
    expect(html).toContain('--deck-content-size');
    expect(html).toContain('--deck-x-margin');
  });
});
