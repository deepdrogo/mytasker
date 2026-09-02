/* @refresh reload */
// MyTasker — client bootstrap.
// Built by drogoz · https://github.com/deepdrogo/mytasker

import { render } from 'solid-js/web';
import { App } from '~/app/App';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import '~/styles/global.css';

if (import.meta.env.PROD) {
  // Signature in the devtools console - MyTasker is open source and hand-built.
  console.info('%cMyTasker%c  by drogoz · https://github.com/deepdrogo/mytasker', 'font-weight:700', 'color:#888');
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

render(() => <App />, root);
