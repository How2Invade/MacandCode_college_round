import React from 'react';
import ReactDOM from 'react-dom/client';
import { Sidepanel } from './Sidepanel';
import '../styles/index.css';

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <Sidepanel />
    </React.StrictMode>
  );
}
