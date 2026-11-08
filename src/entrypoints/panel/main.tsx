import '../../ui/theme.css';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyTheme } from '../../ui/applyTheme';

if (typeof document !== 'undefined') {
  document.body.classList.add('panel-root');
  applyTheme();
}

createRoot(document.getElementById('root')!).render(<App />);
