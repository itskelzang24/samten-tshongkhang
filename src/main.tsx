import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App, { AppErrorBoundary } from './App.tsx';
import './index.css';

// Prevent number inputs from changing value on scroll
document.addEventListener('wheel', (e) => {
  const el = document.activeElement;
  if (el && el instanceof HTMLInputElement && el.type === 'number') {
    el.blur();
  }
}, { passive: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
