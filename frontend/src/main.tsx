/* @refresh reload */
import { render } from 'solid-js/web';
import { App } from '~/app/App';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import '~/styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

render(() => <App />, root);
