import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import './ui/styles.css';
import './ui/combat.css';
import { GameApp } from './GameApp';

const root = document.getElementById('app');
if (root) {
  const app = new GameApp(root);
  void app.initialize();
}
