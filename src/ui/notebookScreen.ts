/**
 * The notebook: an index of pages (one per piece met so far) and the page card.
 * Each page's drawing is a tiny board traced and drawn once by the game's own engine.
 */
import { evaluate } from '../core/rules';
import { trace } from '../core/tracer';
import type { Entity } from '../core/types';
import type { Campaign } from '../game/campaign';
import type { Progress } from '../game/progress';
import { loc, t } from '../i18n';
import { openPages, PAGES, type NotebookPage, type SceneDef } from '../notebook/pages';
import { Renderer } from '../render/renderer';
import { NIGHT } from '../render/theme';
import { h, icon, iconButton } from './dom';
import { pieceIcon } from './pieceIcon';

type Key = Parameters<typeof t>[0];

export const pageTitle = (page: NotebookPage): string => t(`piece_${page.piece}` as Key);

/** Icon for a page, drawn like the piece in the tray. */
const pageIcon = (page: NotebookPage, size: number): HTMLCanvasElement =>
  pieceIcon(page.piece === 'divergingLens' ? 'lens' : page.piece, page.piece === 'divergingLens' ? { f: -1 } : {}, NIGHT, size);

/** Pages the player can read now, in notebook order. */
export const readablePages = (campaign: Campaign): NotebookPage[] => openPages(campaign.worlds, (w) => campaign.worldOpen(w));

/** Is there a readable page the player has not opened yet? */
export const hasNewPage = (campaign: Campaign, progress: Progress): boolean => readablePages(campaign).some((p) => !progress.pageSeen(p.piece));

/** A still picture of a scene: traced once, drawn once, then left alone. */
function sceneCanvas(scene: SceneDef, cssW: number, label: string): HTMLCanvasElement {
  const canvas = h('canvas', { class: 'page-scene', role: 'img', 'aria-label': label });
  const entities: Entity[] = scene.entities.map((e, i) => ({ id: `e${i}`, type: e.type, x: e.x, y: e.y, angle: e.angle ?? 0, params: e.params ?? {} }));
  const renderer = new Renderer(canvas, NIGHT);
  renderer.resize(cssW, Math.round((cssW * scene.h) / scene.w), scene.w, scene.h);
  const result = trace(entities, { width: scene.w, height: scene.h });
  renderer.draw({
    gridW: scene.w,
    gridH: scene.h,
    pieces: entities,
    trace: result,
    statuses: new Map(evaluate(entities, result).targets.map((s) => [s.id, s])),
    lockOf: () => 'fixed',
    selectedId: null,
    hoverId: null,
    floating: null,
    hint: null,
    dropCell: null,
    time: 0,
    wonFor: -1,
  });
  return canvas;
}

export interface NotebookScreenOptions {
  campaign: Campaign;
  progress: Progress;
  onBack(): void;
  onSettings(): void;
  onPage(page: NotebookPage): void;
}

export function notebookScreen(o: NotebookScreenOptions): HTMLElement {
  const readable = new Set(readablePages(o.campaign));
  const list = h('div', { class: 'notebook-list' });
  for (const page of PAGES) {
    const open = readable.has(page);
    const fresh = open && !o.progress.pageSeen(page.piece);
    const title = open ? pageTitle(page) : t('notebookLocked');
    const tile = h(
      'button',
      { class: `page-tile ${open ? 'open' : 'locked'} ${fresh ? 'new' : ''}`, type: 'button', disabled: !open, 'aria-label': fresh ? `${title} (${t('notebookNew')})` : title },
      open ? pageIcon(page, 44) : h('span', { class: 'page-lock' }, icon('lock')),
      h('span', { class: 'page-tile-text' }, h('span', { class: 'page-tile-name' }, open ? title : '?'), h('small', {}, open ? loc(page.law) : t('notebookLocked'))),
    );
    if (open) tile.addEventListener('click', () => o.onPage(page));
    list.append(tile);
  }
  return h(
    'section',
    { class: 'screen notebook-screen' },
    h('header', { class: 'page-header' }, iconButton('back', t('starMap'), o.onBack), h('h1', {}, t('notebook'), h('small', {}, `${readable.size}/${PAGES.length}`)), iconButton('settings', t('settings'), o.onSettings)),
    h('div', { class: 'notebook-body' }, h('p', { class: 'world-intro' }, t('notebookIntro')), list),
  );
}

export interface PageCardOptions {
  page: NotebookPage;
  /** Neighbouring readable pages, for leafing through. */
  previous?: NotebookPage;
  next?: NotebookPage;
  onClose(): void;
  onTurn(page: NotebookPage): void;
}

/** The page itself, as a dialog card. */
export function pageCard(o: PageCardOptions): HTMLElement {
  const { page } = o;
  const width = Math.min(460, window.innerWidth - 32) - 48;
  const turn = (to: NotebookPage | undefined, name: 'back' | 'forward', label: string) => {
    const b = iconButton(name, label, () => to && o.onTurn(to));
    b.disabled = !to;
    return b;
  };
  return h(
    'div',
    { class: 'card page-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'page-title' },
    h('div', { class: 'card-head' }, h('h2', { id: 'page-title' }, pageIcon(page, 32), pageTitle(page)), iconButton('close', t('close'), o.onClose)),
    sceneCanvas(page.scene, width, pageTitle(page)),
    h('p', { class: 'page-law' }, loc(page.law)),
    h('p', { class: 'page-text' }, loc(page.text)),
    h('p', { class: 'page-wild' }, h('strong', {}, t('notebookWild')), ' ', loc(page.wild)),
    h('div', { class: 'page-turn' }, turn(o.previous, 'back', t('notebookPrevious')), turn(o.next, 'forward', t('notebookNext'))),
  );
}
