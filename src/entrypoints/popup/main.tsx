import { createRoot } from 'react-dom/client';
import '../../ui/theme.css';
import App from './App';
import { applyTheme } from '../../ui/applyTheme';

applyTheme();

createRoot(document.getElementById('root')!).render(<App />);
