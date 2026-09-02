// Side-effect only, and first: installs a Promise polyfill before anything
// below — including React itself — runs. See polyfills.ts for why.
import './polyfills';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

const host = document.getElementById('root');
if (host === null) throw new Error('#root is missing from index.html');

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
