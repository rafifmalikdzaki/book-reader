import { describe, expect, it } from 'vitest';

import {
  bubblePosition,
  clampPage,
  computePageDimensions,
  formatZoomValue,
  highlightSearchHtml,
  initialPage,
  isPageRendered,
  nextRotation,
  pageFromNode,
  parsePageHash,
  parseZoomValue,
  stepZoom,
  viewerSrcForPage,
} from './bridgeMath';

describe('bridge maths', () => {
  it('reads only #p<n> hashes', () => {
    expect(parsePageHash('#p12')).toBe(12);
    expect(parsePageHash('#page=12')).toBe(0);
    expect(parsePageHash('#L4')).toBe(0);
    expect(parsePageHash('')).toBe(0);
  });

  it('prefers the hash, then the server page, then page 1', () => {
    expect(initialPage('#p7', 3)).toBe(7);
    expect(initialPage('', 3)).toBe(3);
    expect(initialPage('', null)).toBe(1);
  });

  it('clamps to a positive integer and respects maxPage', () => {
    expect(clampPage(0)).toBe(1);
    expect(clampPage(undefined)).toBe(1);
    expect(clampPage(4.9)).toBe(4);
    expect(clampPage(25, 10)).toBe(10);
  });

  it('finds the page of a selection node', () => {
    document.body.innerHTML =
      '<div class="page" data-page-number="6"><span id="in">t</span></div><span id="out">u</span>';
    expect(pageFromNode(document.getElementById('in')?.firstChild ?? null)).toBe(6);
    expect(pageFromNode(document.getElementById('in'))).toBe(6);
    expect(pageFromNode(document.getElementById('out'))).toBeNull();
    expect(pageFromNode(null)).toBeNull();
  });

  it('centres the bubble over the selection and keeps it 10px inside the window', () => {
    const frame = { left: 10, top: 50 };
    expect(bubblePosition(frame, { left: 100, top: 200, width: 60 }, 74, 1000)).toEqual({
      left: 103,
      top: 208,
    });
    expect(bubblePosition(frame, { left: -50, top: -100, width: 10 }, 0, 1000)).toEqual({
      left: 10,
      top: 10,
    });
    expect(bubblePosition(frame, { left: 990, top: 200, width: 10 }, 74, 1000)).toEqual({
      left: 916,
      top: 208,
    });
  });

  it('computes zoom presets, steps, and clockwise rotations', () => {
    expect(parseZoomValue('page-width')).toBe('page-width');
    expect(parseZoomValue('page-fit')).toBe('page-fit');
    expect(parseZoomValue('1.5')).toBe(1.5);
    expect(parseZoomValue('invalid')).toBe('page-width');
    expect(formatZoomValue(1.25)).toBe('1.25');
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(nextRotation(0)).toBe(90);
    expect(nextRotation(270)).toBe(0);
  });

  it('calculates responsive page dimensions and swaps axes on 90° rotation', () => {
    const portrait = computePageDimensions({
      containerWidth: 900,
      containerHeight: 800,
      intrinsicWidth: 600,
      intrinsicHeight: 800,
      zoom: 1,
      rotation: 0,
    });
    expect(portrait).toEqual({ width: 600, height: 800, scale: 1 });

    const rotated = computePageDimensions({
      containerWidth: 900,
      containerHeight: 800,
      intrinsicWidth: 600,
      intrinsicHeight: 800,
      zoom: 1,
      rotation: 90,
    });
    expect(rotated).toEqual({ width: 800, height: 600, scale: 1 });
  });

  it('windows rendered pages around the active page and highlights search terms safely', () => {
    expect(isPageRendered(5, 5, 2)).toBe(true);
    expect(isPageRendered(7, 5, 2)).toBe(true);
    expect(isPageRendered(8, 5, 2)).toBe(false);
    expect(highlightSearchHtml('A <tag> & gradient step', 'gradient')).toBe(
      'A &lt;tag&gt; &amp; <mark>gradient</mark> step',
    );
  });
});

describe('viewerSrcForPage', () => {
  it('replaces the server page with the page the reader opens on', () => {
    expect(viewerSrcForPage('/v.html?file=%2Fraw%2Fa.pdf#page=3', 4)).toBe('/v.html?file=%2Fraw%2Fa.pdf#page=4');
  });
  it('adds a fragment when there is none and clamps junk to page 1', () => {
    expect(viewerSrcForPage('/v.html?file=x', 0)).toBe('/v.html?file=x#page=1');
  });
});
