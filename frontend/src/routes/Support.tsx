// MyTasker — public support page: donation addresses and how to reach the author, no login required.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { A } from '@solidjs/router';
import { ArrowLeft } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { Logo } from '~/components/shared/Logo';
import { DonateContent } from '~/features/donations/DonateContent';
import styles from './Support.module.css';

export default function Support(): JSX.Element {
  return (
    <div class={styles.root}>
      <header class={styles.nav}>
        <A href="/" class={styles.back}>
          <ArrowLeft size={15} />
          <span>Back to home</span>
        </A>
        <A href="/" aria-label="MyTasker home">
          <Logo size={28} />
        </A>
        <A href="/auth/login" class={styles.login}>
          Log in
        </A>
      </header>
      <main class={styles.main}>
        <p class={styles.eyebrow}>Support the project</p>
        <h1 class={styles.title}>Free forever. Powered by people who find it useful.</h1>
        <p class={styles.sub}>
          MyTasker has no premium tier and never will. If it saves you time, you can chip in for hosting - or just say hi to the author.
        </p>
        <DonateContent />
      </main>
    </div>
  );
}
