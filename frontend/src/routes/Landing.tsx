import { A, Navigate } from '@solidjs/router';
import {
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  Check,
  FolderKanban,
  Heart,
  ListChecks,
  Repeat,
  Send,
  Sparkles,
  Sun,
  Timer,
  Users,
} from 'lucide-solid';
import type { Component, JSX } from 'solid-js';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { Logo, LogoMark } from '~/components/shared/Logo';
import { authStore } from '~/stores/auth';
import styles from './Landing.module.css';

interface Feature {
  icon: Component<{ size?: number; 'stroke-width'?: number }>;
  title: string;
  text: string;
}

const FEATURES: Feature[] = [
  { icon: Sun, title: 'Today', text: 'One screen with everything due, overdue and planned for the day.' },
  { icon: ListChecks, title: 'Tasks', text: 'Personal and business lists, upcoming, reminders, subtasks.' },
  { icon: FolderKanban, title: 'Projects', text: 'Private, group and idea projects with activity and files.' },
  { icon: Sparkles, title: 'Prompts', text: 'A versioned library for the prompts you actually reuse.' },
  { icon: Repeat, title: 'Routine', text: 'Rules that recreate recurring work for you, automatically.' },
  { icon: Timer, title: 'Time tracking', text: 'One-tap timer per task, totals per project and per day.' },
  { icon: BarChart3, title: 'Insights', text: 'Daily, weekly and monthly reports on where your time went.' },
  { icon: Send, title: 'Telegram bot', text: '/add, /done, /today, /timer - reminders and summaries in chat.' },
  { icon: Bot, title: 'AI command bar', text: 'Admin-only assistant that turns plain language into tasks and plans.' },
  { icon: Users, title: 'Collaboration', text: 'Comments, mentions, activity feed and public share links.' },
];

const MOCK_TASKS = [
  { title: 'Ship landing page', tag: 'Business', done: true },
  { title: 'Call supplier about Q4 order', tag: 'Business', done: true },
  { title: 'Gym - upper body', tag: 'Personal', done: false },
  { title: 'Review prompt v3 for outreach', tag: 'Business', done: false },
];

const WEEK_BARS = [42, 70, 55, 88, 64, 30, 18];

export default function Landing(): JSX.Element {
  return (
    <Show when={!authStore.isAuthenticated()} fallback={<Navigate href="/today" />}>
      <LandingView />
    </Show>
  );
}

function LandingView(): JSX.Element {
  const [tilt, setTilt] = createSignal({ x: 0, y: 0 });
  const [spot, setSpot] = createSignal({ x: 50, y: 40 });
  let stageRef: HTMLDivElement | undefined;

  const botUsername = () => authStore.config()?.telegram_bot_username || 'mytaskerproductiondrogoz_bot';
  const botUrl = () => `https://t.me/${botUsername()}`;

  const fine = () =>
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const onStageMove = (e: PointerEvent) => {
    if (!stageRef || !fine()) return;
    const r = stageRef.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width - 0.5;
    const ny = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ x: -ny * 12, y: nx * 16 });
  };
  const onStageLeave = () => setTilt({ x: 0, y: 0 });

  onMount(() => {
    const prev = document.title;
    document.title = 'MyTasker - always free control center for life, business and time';
    const move = (e: PointerEvent) => {
      if (!fine()) return;
      setSpot({ x: (e.clientX / window.innerWidth) * 100, y: (e.clientY / window.innerHeight) * 100 });
    };
    window.addEventListener('pointermove', move, { passive: true });
    onCleanup(() => {
      document.title = prev;
      window.removeEventListener('pointermove', move);
    });
  });

  const todayLabel = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(
    new Date(),
  );

  return (
    <div class={styles.root}>
      <div
        class={styles.bg}
        aria-hidden="true"
        style={{ '--spot-x': `${spot().x}%`, '--spot-y': `${spot().y}%` }}
      >
        <div class={styles.grid} />
        <div class={styles.glowA} />
        <div class={styles.glowB} />
        <div class={styles.spot} />
      </div>

      <header class={styles.nav}>
        <A href="/" class={styles.brand} aria-label="MyTasker home">
          <Logo size={30} />
        </A>
        <nav class={styles.navLinks} aria-label="Primary">
          <a href="#features">Features</a>
          <a href={botUrl()} target="_blank" rel="noreferrer">
            Telegram
          </a>
          <A href="/donate">Support</A>
        </nav>
        <div class={styles.navActions}>
          <A href="/auth/login" class={styles.ghostBtn}>
            Log in
          </A>
          <A href="/auth/register" class={styles.solidBtn}>
            Get started
            <ArrowRight size={14} stroke-width={2.2} />
          </A>
        </div>
      </header>

      <main class={styles.hero}>
        <section class={styles.copy}>
          <div class={styles.badge}>
            <span class={styles.pulse} aria-hidden="true" />
            Always free <span class={styles.badgeSep}>·</span> by <strong>drogoz</strong>
          </div>
          <h1 class={styles.h1}>
            One control center for <em>life</em>, <em>business</em> and <em>time</em>.
          </h1>
          <p class={styles.lead}>
            Tasks, projects, prompts, routines, time tracking and insights - with a Telegram bot that keeps you on track.
            No premium tier. No trial. No paywall, ever.
          </p>
          <div class={styles.cta}>
            <A href="/auth/register" class={styles.primary}>
              Start for free
              <ArrowRight size={16} stroke-width={2.2} />
            </A>
            <a href={botUrl()} class={styles.secondary} target="_blank" rel="noreferrer">
              <Send size={15} stroke-width={2} />
              Open Telegram bot
            </a>
          </div>
          <ul class={styles.proof}>
            <li>
              <Check size={13} stroke-width={2.6} /> No credit card
            </li>
            <li>
              <Check size={13} stroke-width={2.6} /> Unlimited tasks & projects
            </li>
            <li>
              <Check size={13} stroke-width={2.6} /> Works on any device
            </li>
          </ul>
        </section>

        <section
          class={styles.stage}
          ref={stageRef}
          onPointerMove={onStageMove}
          onPointerLeave={onStageLeave}
          aria-label="Product preview"
        >
          <div class={styles.scene} style={{ transform: `rotateX(${tilt().x}deg) rotateY(${tilt().y}deg)` }}>
            <div class={styles.cardMain}>
              <div class={styles.winBar}>
                <LogoMark size={16} />
                <span class={styles.winTitle}>Today</span>
                <span class={styles.winDate}>{todayLabel}</span>
              </div>
              <div class={styles.progressRow}>
                <span class={styles.progressLabel}>2 of 4 done</span>
                <span class={styles.progressBar}>
                  <i style={{ width: '50%' }} />
                </span>
              </div>
              <ul class={styles.taskList}>
                <For each={MOCK_TASKS}>
                  {(t) => (
                    <li class={styles.task} classList={{ [styles.taskDone!]: t.done }}>
                      <span class={styles.check}>
                        <Show when={t.done}>
                          <Check size={11} stroke-width={3} />
                        </Show>
                      </span>
                      <span class={styles.taskTitle}>{t.title}</span>
                      <span class={styles.taskTag}>{t.tag}</span>
                    </li>
                  )}
                </For>
              </ul>
            </div>

            <div class={`${styles.floating} ${styles.cardTimer}`}>
              <div class={styles.miniHead}>
                <Timer size={13} stroke-width={2.2} />
                Timer running
              </div>
              <div class={styles.time}>01:24:37</div>
              <div class={styles.miniSub}>Deep work · Q4 roadmap</div>
            </div>

            <div class={`${styles.floating} ${styles.cardTg}`}>
              <div class={styles.tgHead}>
                <span class={styles.tgAvatar}>
                  <Send size={12} stroke-width={2.4} />
                </span>
                <span>MyTasker bot</span>
                <span class={styles.tgTime}>09:50</span>
              </div>
              <div class={styles.tgMsg}>
                <Bell size={12} stroke-width={2.2} /> In 10 min: <b>Call supplier about Q4 order</b>
              </div>
              <div class={styles.tgReply}>/done 2</div>
            </div>

            <div class={`${styles.floating} ${styles.cardWeek}`}>
              <div class={styles.miniHead}>
                <BarChart3 size={13} stroke-width={2.2} />
                This week
              </div>
              <div class={styles.bars}>
                <For each={WEEK_BARS}>{(h) => <i style={{ height: `${h}%` }} />}</For>
              </div>
              <div class={styles.miniSub}>31h 20m tracked</div>
            </div>
          </div>
        </section>
      </main>

      <section id="features" class={styles.features} aria-label="Features">
        <For each={FEATURES}>
          {(f) => (
            <article class={styles.tile}>
              <span class={styles.tileIcon}>
                <f.icon size={16} stroke-width={1.9} />
              </span>
              <div class={styles.tileBody}>
                <h3 class={styles.tileTitle}>{f.title}</h3>
                <p class={styles.tileText}>{f.text}</p>
              </div>
            </article>
          )}
        </For>
      </section>

      <footer class={styles.footer}>
        <span class={styles.footFree}>
          <LogoMark size={14} variant="glyph" class={styles.footGlyph} />
          <Heart size={12} stroke-width={2.4} />
          Always free by <strong>drogoz</strong> - no premium tier, no trials, no paywalls.
        </span>
        <span class={styles.footLinks}>
          <A href="/auth/login">Log in</A>
          <A href="/auth/register">Create account</A>
          <a href={botUrl()} target="_blank" rel="noreferrer">
            @{botUsername()}
          </a>
          <A href="/donate">Support hosting</A>
        </span>
      </footer>
    </div>
  );
}
