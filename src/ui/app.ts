import { sound } from '../audio/sound';
import { Campaign } from '../game/campaign';
import { Progress } from '../game/progress';
import { Session } from '../game/session';
import { detectLanguage, LANGUAGES, loc, onLanguageChange, setLanguage, t, language, type Lang } from '../i18n';
import { dailyId, dailyKey, generateDaily, previousKey } from '../level/daily';
import type { LevelDef } from '../level/schema';
import { LEVELS, WORLDS } from '../levels';
import { h, iconButton } from './dom';
import { GameScreen, type WinCard } from './gameScreen';
import { mapScreen, worldScreen } from './mapScreens';

type Route =
  | { name: 'menu' }
  | { name: 'map' }
  | { name: 'world'; id: string }
  | { name: 'game'; id: string }
  | { name: 'daily'; key: string };

type Screen = { el: HTMLElement; destroy?: () => void; refresh?: () => void };

/** Screen router and app-wide state. */
export class App {
  private progress = new Progress();
  private current: Screen | null = null;
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

  /** Progression over the current save. Dev builds can open everything with ?unlock. */
  private campaign(): Campaign {
    const unlockAll = import.meta.env.DEV && new URLSearchParams(location.search).has('unlock');
    return new Campaign(WORLDS, LEVELS, (id) => !!this.progress.level(id), unlockAll);
  }

  private routeFromHash(): Route {
    const hash = location.hash;
    const level = hash.match(/^#\/level\/(.+)$/);
    // Dev builds can open any level directly.
    if (level && (import.meta.env.DEV || this.campaign().levelOpen(level[1])) && this.campaign().ref(level[1])) return { name: 'game', id: level[1] };
    const world = hash.match(/^#\/world\/(.+)$/);
    if (world) {
      const w = this.campaign().world(world[1]);
      if (w && this.campaign().worldOpen(w)) return { name: 'world', id: w.id };
    }
    if (hash === '#/map' || hash === '#/levels') return { name: 'map' };
    if (hash === '#/daily') return { name: 'daily', key: dailyKey() };
    // Dev builds can open any day's puzzle.
    const d = hash.match(/^#\/daily\/(\d{4}-\d{2}-\d{2})$/);
    if (d && import.meta.env.DEV) return { name: 'daily', key: d[1] };
    return { name: 'menu' };
  }

  private hashFor(route: Route): string {
    switch (route.name) {
      case 'map':
        return '#/map';
      case 'world':
        return `#/world/${route.id}`;
      case 'game':
        return `#/level/${route.id}`;
      case 'daily':
        return '#/daily';
      default:
        return '#/';
    }
  }

  private go(route: Route, push = true): void {
    this.route = route;
    const hash = this.hashFor(route);
    if (push && location.hash !== hash) history.pushState(null, '', hash);
    this.current?.destroy?.();
    this.current?.el.remove();
    const screen =
      route.name === 'map'
        ? this.map()
        : route.name === 'world'
          ? this.world(route.id)
          : route.name === 'game'
            ? this.game(route.id)
            : route.name === 'daily'
              ? this.daily(route.key)
              : this.menu();
    this.current = screen;
    this.root.insertBefore(screen.el, this.modalRoot);
    const focusable = screen.el.querySelector<HTMLElement>('[autofocus], .btn.primary');
    focusable?.focus({ preventScroll: true });
  }

  /* ---------- Screens ---------- */

  private menu(): Screen {
    const next = this.campaign().next();
    const started = LEVELS.some((l) => this.progress.level(l.id));
    const play = h('button', { class: 'btn primary big', type: 'button', autofocus: true }, started ? t('continue') : t('play'));
    play.addEventListener('click', () => {
      sound.unlock();
      sound.play('click');
      this.go(next ? { name: 'game', id: next.level.id } : { name: 'map' });
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
        h('button', { class: 'btn', type: 'button', onclick: () => this.go({ name: 'map' }) }, t('starMap')),
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

  private map(): Screen {
    return this.rebuildOnResize(() =>
      mapScreen({
        campaign: this.campaign(),
        progress: this.progress,
        onBack: () => this.go({ name: 'menu' }),
        onSettings: () => this.openSettings(),
        onWorld: (w) => this.go({ name: 'world', id: w.id }),
      }),
    );
  }

  private world(id: string): Screen {
    const campaign = this.campaign();
    const world = campaign.world(id)!;
    return this.rebuildOnResize(() =>
      worldScreen({
        world,
        levels: LEVELS,
        campaign: this.campaign(),
        progress: this.progress,
        onBack: () => this.go({ name: 'map' }),
        onSettings: () => this.openSettings(),
        onLevel: (level) => {
          if (this.live?.id === level.id && this.live.session.won) this.live = null;
          this.go({ name: 'game', id: level.id });
        },
      }),
    );
  }

  /** Screens whose layout depends on the available space are rebuilt after resizing settles. */
  private rebuildOnResize(build: () => HTMLElement): Screen {
    const screen: Screen = { el: build() };
    let timer = 0;
    let size = { w: window.innerWidth, h: window.innerHeight };
    const onResize = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        // Ignore the address bar sliding in and out on phones (a small height change), so scrolling isn't reset.
        if (window.innerWidth === size.w && Math.abs(window.innerHeight - size.h) < 150) return;
        size = { w: window.innerWidth, h: window.innerHeight };
        const fresh = build();
        screen.el.replaceWith(fresh);
        screen.el = fresh;
      }, 150);
    };
    window.addEventListener('resize', onResize);
    screen.destroy = () => {
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
    return screen;
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

  private game(id: string): Screen {
    const before = this.campaign();
    const ref = before.ref(id)!;
    const { world, level, index } = ref;
    const openBefore = before.openWorldIds();
    const winCard = (): WinCard => {
      const after = this.campaign();
      const opened = after.worlds.filter((w) => after.worldOpen(w) && !openBefore.has(w.id));
      const next = after.next(world);
      const sameWorld = next?.world === world;
      const complete = after.solvedCount(world) === world.levels.length;
      return {
        text: complete ? t('worldComplete') : t('solvedText'),
        news: opened.length ? t('worldOpened', { world: opened.map((w) => loc(w.name)).join(', ') }) : undefined,
        nextLabel: sameWorld ? t('next') : t('toMap'),
        next: () => this.go(sameWorld ? { name: 'game', id: next!.level.id } : { name: 'map' }),
      };
    };
    const screen = new GameScreen({
      level,
      session: this.sessionFor(level),
      kicker: `${loc(world.name)} · ${index + 1}`,
      progress: this.progress,
      winCard,
      onExit: () => this.go({ name: 'world', id: world.id }),
      onReplay: () => {
        this.live = null;
        this.go({ name: 'game', id }, false);
      },
      onSettings: () => this.openSettings(),
    });
    return { el: screen.el, destroy: () => screen.destroy(), refresh: () => screen.applySettings() };
  }

  private daily(key: string): Screen {
    const level = generateDaily(key);
    const screen = new GameScreen({
      level,
      session: this.sessionFor(level),
      kicker: t('daily'),
      progress: this.progress,
      winCard: () => ({ text: t('dailyDone'), nextLabel: t('back'), next: () => this.go({ name: 'menu' }) }),
      onExit: () => this.go({ name: 'menu' }),
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
