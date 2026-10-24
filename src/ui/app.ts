import { sound } from '../audio/sound';
import { Progress } from '../game/progress';
import { Session } from '../game/session';
import { detectLanguage, LANGUAGES, loc, onLanguageChange, setLanguage, t, language, type Lang } from '../i18n';
import { dailyId, dailyKey, generateDaily, previousKey } from '../level/daily';
import type { LevelDef } from '../level/schema';
import { LEVELS } from '../levels';
import { h, icon, iconButton } from './dom';
import { GameScreen } from './gameScreen';

type Route = { name: 'menu' } | { name: 'levels' } | { name: 'game'; index: number } | { name: 'daily'; key: string };

/** Screen router and app-wide state. */
export class App {
  private progress = new Progress();
  private current: { el: HTMLElement; destroy?: () => void; refresh?: () => void } | null = null;
  /** The level in progress, kept across screen rebuilds (language switch). */
  private live: { id: string; session: Session } | null = null;
  private route: Route = { name: 'menu' };
  private modalRoot = h('div', { class: 'modal-root' });

  constructor(private root: HTMLElement) {
    const s = this.progress.data.settings;
    setLanguage(s.lang ?? detectLanguage());
    sound.enabled = s.sound;
    document.documentElement.classList.toggle('reduce-motion', s.reducedMotion);
    root.append(this.modalRoot);
    onLanguageChange(() => this.go(this.route, false));
    window.addEventListener('popstate', () => this.go(this.routeFromHash(), false));
    this.go(this.routeFromHash(), false);
  }

  private routeFromHash(): Route {
    const m = location.hash.match(/^#\/level\/(.+)$/);
    if (m) {
      const index = LEVELS.findIndex((l) => l.id === m[1]);
      const ids = LEVELS.map((l) => l.id);
      // Dev builds can open any level directly.
      if (index >= 0 && (import.meta.env.DEV || this.progress.isUnlocked(index, ids))) return { name: 'game', index };
    }
    if (location.hash === '#/levels') return { name: 'levels' };
    if (location.hash === '#/daily') return { name: 'daily', key: dailyKey() };
    // Dev builds can open any day's puzzle.
    const d = location.hash.match(/^#\/daily\/(\d{4}-\d{2}-\d{2})$/);
    if (d && import.meta.env.DEV) return { name: 'daily', key: d[1] };
    return { name: 'menu' };
  }

  private go(route: Route, push = true): void {
    this.route = route;
    const hash = route.name === 'game' ? `#/level/${LEVELS[route.index].id}` : route.name === 'levels' ? '#/levels' : route.name === 'daily' ? '#/daily' : '#/';
    if (push && location.hash !== hash) history.pushState(null, '', hash);
    this.current?.destroy?.();
    this.current?.el.remove();
    const screen =
      route.name === 'menu'
        ? this.menu()
        : route.name === 'levels'
          ? this.levels()
          : route.name === 'daily'
            ? this.daily(route.key)
            : this.game(route.index);
    this.current = screen;
    this.root.insertBefore(screen.el, this.modalRoot);
    const focusable = screen.el.querySelector<HTMLElement>('[autofocus], .btn.primary');
    focusable?.focus({ preventScroll: true });
  }

  /* ---------- Screens ---------- */

  private nextUnsolved(): number {
    const i = LEVELS.findIndex((l) => !this.progress.level(l.id));
    return i < 0 ? 0 : i;
  }

  private menu(): { el: HTMLElement } {
    const started = Object.keys(this.progress.data.levels).length > 0;
    const play = h('button', { class: 'btn primary big', type: 'button', autofocus: true }, started ? t('continue') : t('play'));
    play.addEventListener('click', () => {
      sound.unlock();
      sound.play('click');
      this.go({ name: 'game', index: this.nextUnsolved() });
    });
    const el = h(
      'section',
      { class: 'screen menu-screen' },
      h('div', { class: 'logo', 'aria-hidden': 'true' }, h('span', { class: 'logo-beam' }), h('span', { class: 'logo-prism' }), h('span', { class: 'logo-fan' })),
      h('h1', { class: 'title' }, t('appTitle')),
      h('p', { class: 'tagline' }, t('tagline')),
      h(
        'nav',
        { class: 'menu-actions' },
        play,
        this.dailyButton(),
        h('button', { class: 'btn', type: 'button', onclick: () => this.go({ name: 'levels' }) }, t('levels')),
        h('button', { class: 'btn', type: 'button', onclick: () => this.openSettings() }, t('settings')),
      ),
    );
    return { el };
  }

  private dailyButton(): HTMLElement {
    const today = dailyKey();
    const solved = !!this.progress.level(dailyId(today));
    const streak = this.progress.streak(today, dailyId, previousKey);
    const status = solved ? t('dailySolved') : t('dailyNew');
    const b = h(
      'button',
      { class: `btn daily-btn ${solved ? 'solved' : ''}`, type: 'button' },
      h('span', {}, t('daily')),
      h('small', {}, streak > 1 ? `${status} · ${t('dailyStreak', { n: streak })}` : status),
    );
    b.addEventListener('click', () => {
      sound.unlock();
      sound.play('click');
      if (this.live?.id === dailyId(today) && this.live.session.won) this.live = null;
      this.go({ name: 'daily', key: today });
    });
    return b;
  }

  private levels(): { el: HTMLElement } {
    const ids = LEVELS.map((l) => l.id);
    const worlds = new Map<number, HTMLElement>();
    const list = h('div', { class: 'worlds' });
    LEVELS.forEach((level, i) => {
      let grid = worlds.get(level.world);
      if (!grid) {
        grid = h('div', { class: 'level-grid' });
        worlds.set(level.world, grid);
        const key = `world${level.world}` as Parameters<typeof t>[0];
        list.append(h('h2', { class: 'world-title' }, t(key) || `World ${level.world}`), grid);
      }
      const unlocked = this.progress.isUnlocked(i, ids);
      const done = this.progress.level(level.id);
      const stars = h('span', { class: 'mini-stars' });
      for (let s = 0; s < 3; s++) stars.append(h('span', { class: done && s < done.stars ? 'on' : '' }, '★'));
      const btn = h(
        'button',
        { class: `level-card ${done ? 'done' : ''}`, type: 'button', disabled: !unlocked, 'aria-label': `${t('levelN', { n: i + 1 })}: ${loc(level.name)}${unlocked ? '' : ` (${t('locked')})`}` },
        h('span', { class: 'num' }, String(i + 1)),
        h('span', { class: 'name' }, loc(level.name)),
        unlocked ? stars : icon('lock'),
      );
      btn.addEventListener('click', () => {
        if (this.live?.id === level.id && this.live.session.won) this.live = null;
        this.go({ name: 'game', index: i });
      });
      grid.append(btn);
    });
    const el = h(
      'section',
      { class: 'screen levels-screen' },
      h('header', { class: 'page-header' }, iconButton('back', t('back'), () => this.go({ name: 'menu' })), h('h1', {}, t('levels')), iconButton('settings', t('settings'), () => this.openSettings())),
      list,
    );
    return { el };
  }

  /** The session for a level, resumed if it is the one in progress. */
  private sessionFor(level: LevelDef): Session {
    if (this.live?.id !== level.id) {
      this.live = { id: level.id, session: new Session(level) };
      // Dev aid: ?solve applies the reference solution (screenshots, level tuning).
      if (import.meta.env.DEV && new URLSearchParams(location.search).has('solve')) this.live.session.applySolution();
    }
    return this.live.session;
  }

  private game(index: number): { el: HTMLElement; destroy: () => void; refresh: () => void } {
    const level = LEVELS[index];
    const last = index + 1 >= LEVELS.length;
    const screen = new GameScreen({
      level,
      session: this.sessionFor(level),
      kicker: t('levelN', { n: index + 1 }),
      nextLabel: last ? t('levels') : t('next'),
      doneText: last ? t('allDone') : t('solvedText'),
      progress: this.progress,
      onExit: () => this.go({ name: 'levels' }),
      onNext: () => (last ? this.go({ name: 'levels' }) : this.go({ name: 'game', index: index + 1 })),
      onReplay: () => {
        this.live = null;
        this.go({ name: 'game', index }, false);
      },
      onSettings: () => this.openSettings(),
    });
    return { el: screen.el, destroy: () => screen.destroy(), refresh: () => screen.applySettings() };
  }

  private daily(key: string): { el: HTMLElement; destroy: () => void; refresh: () => void } {
    const level = generateDaily(key);
    const screen = new GameScreen({
      level,
      session: this.sessionFor(level),
      kicker: t('daily'),
      nextLabel: t('back'),
      doneText: t('dailyDone'),
      progress: this.progress,
      onExit: () => this.go({ name: 'menu' }),
      onNext: () => this.go({ name: 'menu' }),
      onReplay: () => {
        this.live = null;
        this.go({ name: 'daily', key }, false);
      },
      onSettings: () => this.openSettings(),
    });
    return { el: screen.el, destroy: () => screen.destroy(), refresh: () => screen.applySettings() };
  }

  /* ---------- Settings ---------- */

  private openSettings(): void {
    const s = () => this.progress.data.settings;
    const close = () => {
      overlay.remove();
      this.current?.refresh?.();
    };
    const toggle = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const b = h('button', { class: 'toggle', type: 'button', role: 'switch' });
      const sync = () => {
        b.setAttribute('aria-checked', String(get()));
        b.textContent = get() ? t('on') : t('off');
      };
      b.addEventListener('click', () => {
        set(!get());
        sync();
        sound.play('click');
      });
      sync();
      return h('div', { class: 'setting' }, h('span', {}, label), b);
    };
    const langs = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': t('language') });
    for (const l of LANGUAGES) {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(language() === l.id) }, l.label);
      b.addEventListener('click', () => {
        this.progress.updateSettings({ lang: l.id as Lang });
        overlay.remove();
        setLanguage(l.id); // Rebuilds the current screen.
        this.openSettings();
      });
      langs.append(b);
    }
    const quality = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': t('quality') });
    for (const q of ['high', 'low'] as const) {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(s().quality === q) }, q === 'high' ? t('qualityHigh') : t('qualityLow'));
      b.addEventListener('click', () => {
        this.progress.updateSettings({ quality: q });
        for (const o of quality.children) o.setAttribute('aria-checked', String(o === b));
      });
      quality.append(b);
    }
    const reset = h('button', { class: 'btn danger', type: 'button' }, t('resetProgress'));
    reset.addEventListener('click', () => {
      if (confirm(t('resetConfirm'))) {
        this.progress.resetLevels();
        this.live = null;
        overlay.remove();
        this.go({ name: 'menu' });
      }
    });
    const card = h(
      'div',
      { class: 'card settings-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'settings-title' },
      h('div', { class: 'card-head' }, h('h2', { id: 'settings-title' }, t('settings')), iconButton('close', t('close'), close)),
      h('div', { class: 'setting' }, h('span', {}, t('language')), langs),
      toggle(t('sound'), () => s().sound, (v) => {
        this.progress.updateSettings({ sound: v });
        sound.enabled = v;
      }),
      toggle(t('motion'), () => s().reducedMotion, (v) => {
        this.progress.updateSettings({ reducedMotion: v });
        document.documentElement.classList.toggle('reduce-motion', v);
      }),
      h('div', { class: 'setting' }, h('span', {}, t('quality')), quality),
      h('p', { class: 'help' }, t('keyboardHelp')),
      reset,
    );
    const overlay = h('div', { class: 'overlay' }, card);
    overlay.addEventListener('click', (e) => e.target === overlay && close());
    overlay.addEventListener('keydown', (e) => e.key === 'Escape' && close());
    this.modalRoot.append(overlay);
    card.querySelector<HTMLElement>('button')?.focus();
  }
}
