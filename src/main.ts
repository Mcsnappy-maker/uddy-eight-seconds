import './style.css';
import { HockeyGameApp } from './game/HockeyGameApp';

const canvas = document.getElementById('render-canvas') as HTMLCanvasElement | null;
const uiRoot = document.getElementById('ui-root');

if (!canvas || !uiRoot) {
  throw new Error('Missing #render-canvas or #ui-root container.');
}

const app = new HockeyGameApp(canvas, uiRoot);
app.init().catch((err) => {
  console.error('Failed to initialize Uddy: Eight Seconds:', err);
  app.reportInitError(err);
});
