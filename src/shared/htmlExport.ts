import {
  DeckSpec,
  FPS,
  PASSAGE_TITLES,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  buildSlidePlan,
  splitParagraphs,
} from './deck.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderParagraphs(content: string): string {
  return splitParagraphs(content)
    .map((paragraph) => `<p dir="auto">${escapeHtml(paragraph)}</p>`)
    .join('\n');
}

export function buildStandaloneHtml(deck: DeckSpec): string {
  const slides = buildSlidePlan(deck);
  const totalSeconds = slides.reduce((sum, slide) => sum + slide.durationInFrames / FPS, 0);
  const slideMarkup = slides
    .map((slide) => {
      const delay = slide.startFrame / FPS;
      const duration = slide.durationInFrames / FPS;
      const style = `--delay:${delay}s;--duration:${duration}s;`;

      if (slide.kind === 'content') {
        return `<section class="slide content-slide" style="${style}">
  <div class="content-mask">
    <article class="content-wall" style="--duration:${duration}s;">
      ${renderParagraphs(slide.content ?? '')}
    </article>
  </div>
</section>`;
      }

      const isMain = slide.kind === 'title';
      return `<section class="slide title-slide" style="${style}">
  <div class="${isMain ? 'title-block title-block-main' : 'title-block'}">
    <p class="title-kicker">Khutbah Video</p>
    <h1>${escapeHtml(slide.title ?? '')}</h1>
  </div>
</section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(deck.title)} - Khutbah Deck</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #101312;
      --paper: #f6efe1;
      --gold: #d6b874;
      --teal: #1c605b;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--bg);
      color: var(--paper);
      font-family: Georgia, "Times New Roman", "Noto Naskh Arabic", serif;
    }
    .deck {
      position: relative;
      width: 100vw;
      height: 100vh;
      aspect-ratio: ${VIDEO_WIDTH} / ${VIDEO_HEIGHT};
      background:
        linear-gradient(135deg, rgba(201, 173, 108, 0.12), transparent 36%),
        linear-gradient(315deg, rgba(28, 96, 91, 0.22), transparent 42%),
        var(--bg);
      overflow: hidden;
    }
    .deck::before {
      content: "";
      position: absolute;
      inset: 5.37vh;
      border: 2px solid rgba(214, 184, 116, 0.45);
      box-shadow: inset 0 0 0 1px rgba(246, 239, 225, 0.08);
      z-index: 8;
      pointer-events: none;
    }
    .slide {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      animation: slideVisible var(--duration) linear var(--delay) both;
    }
    .title-slide { text-align: center; padding: 11vh 7vw; }
    .title-block {
      max-width: 62vw;
      animation: titleTravel var(--duration) cubic-bezier(0.2, 0.84, 0.22, 1) var(--delay) both;
    }
    .title-kicker {
      margin: 0 0 2.2vh;
      color: var(--gold);
      font-size: 2.9vh;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    .title-block h1 {
      margin: 0;
      font-size: 10.9vh;
      font-weight: 700;
      line-height: 1.05;
      text-wrap: balance;
    }
    .title-block-main h1 { font-size: 14vh; }
    .content-slide {
      padding: 10.9vh 8.85vw;
      align-items: stretch;
    }
    .content-mask {
      position: relative;
      width: 100%;
      overflow: hidden;
    }
    .content-mask::before,
    .content-mask::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      z-index: 2;
      height: 14vh;
      pointer-events: none;
    }
    .content-mask::before {
      top: 0;
      background: linear-gradient(var(--bg), rgba(16, 19, 18, 0));
    }
    .content-mask::after {
      bottom: 0;
      background: linear-gradient(rgba(16, 19, 18, 0), var(--bg));
    }
    .content-wall {
      width: min(68.75vw, 100%);
      margin: 0 auto;
      padding: 11vh 0 22vh;
      font-size: 5vh;
      line-height: 1.64;
      color: var(--paper);
      animation: contentScroll var(--duration) linear var(--delay) both;
    }
    .content-wall p {
      margin: 0 0 6.6vh;
      white-space: pre-wrap;
    }
    .content-wall p[dir="rtl"],
    .content-wall p:dir(rtl) {
      font-size: 5.9vh;
      line-height: 1.9;
      text-align: right;
    }
    @keyframes slideVisible {
      0%, 100% { opacity: 0; }
      7%, 86% { opacity: 1; }
    }
    @keyframes titleTravel {
      0% { transform: translateY(15vh); opacity: 0; }
      18%, 78% { transform: translateY(0); opacity: 1; }
      100% { transform: translateY(-15vh); opacity: 0; }
    }
    @keyframes contentScroll {
      from { transform: translateY(8%); }
      to { transform: translateY(-78%); }
    }
  </style>
</head>
<body>
  <main class="deck" aria-label="${escapeHtml(deck.title)}">
    ${slideMarkup}
  </main>
  <script>
    window.__KHUTBAH_DECK__ = ${JSON.stringify({
      title: deck.title,
      passageTitles: [PASSAGE_TITLES.passage1, PASSAGE_TITLES.passage2],
      totalSeconds,
    })};
  </script>
</body>
</html>`;
}
