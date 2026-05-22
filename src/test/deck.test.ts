import {describe, expect, it} from 'vitest';
import {
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
});

describe('standalone html export', () => {
  it('contains all five slide surfaces and fixed passage titles', () => {
    const html = buildStandaloneHtml(defaultDeck);

    expect(html.match(/class="slide/g)).toHaveLength(5);
    expect(html).toContain(PASSAGE_TITLES.passage1);
    expect(html).toContain(PASSAGE_TITLES.passage2);
    expect(html).toContain(defaultDeck.title);
  });
});
