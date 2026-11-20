// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMagnifier, type Magnifier } from '../app/magnifier';

describe('magnifier', () => {
  let host: HTMLElement;
  let page: HTMLCanvasElement;
  let slideshow: boolean;
  let magnifier: Magnifier;

  const loupe = () => document.querySelector<HTMLElement>('.magnifier');
  const move = (target: EventTarget, clientX: number, clientY: number) =>
    target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX, clientY }));

  beforeEach(() => {
    document.body.innerHTML = '<div id="pdf-container"><canvas id="page"></canvas></div>';
    host = document.getElementById('pdf-container') as HTMLElement;
    page = document.getElementById('page') as HTMLCanvasElement;
    host.style.setProperty('--monight-reading-filter', 'invert(1)');
    slideshow = false;
    magnifier = createMagnifier({ host, isSlideshow: () => slideshow });
  });

  afterEach(() => magnifier.destroy());

  it('starts hidden, and toggling shows then hides the loupe', () => {
    expect(magnifier.visible()).toBe(false);
    magnifier.toggle();
    expect(magnifier.visible()).toBe(true);
    magnifier.toggle();
    expect(magnifier.visible()).toBe(false);
    expect(loupe()?.hidden ?? true).toBe(true);
  });

  it('tells observers when its visibility changes', () => {
    const seen: boolean[] = [];
    const stop = magnifier.observe((visible) => seen.push(visible));
    magnifier.toggle();
    magnifier.toggle();
    stop();
    magnifier.toggle();
    expect(seen).toEqual([true, false]);
  });

  it('follows the pointer over the page area and applies the reading filter', () => {
    magnifier.toggle();
    expect(loupe()?.hidden ?? true).toBe(true);
    move(page, 200, 120);
    const shown = loupe() as HTMLElement;
    expect(shown.hidden).toBe(false);
    const first = [shown.style.left, shown.style.top];
    move(page, 300, 220);
    expect([shown.style.left, shown.style.top]).not.toEqual(first);
    expect(shown.querySelector('canvas')?.style.filter).toBe('invert(1)');
  });

  it('hides while the pointer is outside the page area', () => {
    magnifier.toggle();
    move(page, 200, 120);
    host.dispatchEvent(new MouseEvent('pointerleave'));
    expect(loupe()?.hidden).toBe(true);
    move(page, 200, 120);
    expect(loupe()?.hidden).toBe(false);
  });

  it('is not shown in Slideshow', () => {
    magnifier.toggle();
    slideshow = true;
    move(page, 200, 120);
    expect(loupe()?.hidden ?? true).toBe(true);
  });

  it('can be hidden explicitly, as when the last Document closes', () => {
    magnifier.toggle();
    move(page, 200, 120);
    magnifier.hide();
    expect(magnifier.visible()).toBe(false);
    expect(loupe()?.hidden).toBe(true);
  });
});
