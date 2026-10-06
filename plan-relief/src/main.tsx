import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Polices intégrées au build (CSP : font-src 'self', aucun appel à Google Fonts).
import '@fontsource/archivo/500.css';
import '@fontsource/archivo/700.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import App from './App';
import { ConfirmProvider, ToastProvider } from './components/ui';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </ToastProvider>
  </StrictMode>,
);
