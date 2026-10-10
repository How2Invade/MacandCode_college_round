import React from 'react';
import ReactDOM from 'react-dom/client';
import { Popup } from './Popup';
import '../styles/index.css';

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <Popup />
    </React.StrictMode>
  );
}
