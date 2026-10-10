import React from 'react';

export const Popup: React.FC = () => {
  const handleOpenSidepanel = async () => {
    if (typeof chrome !== 'undefined' && chrome.sidePanel && chrome.sidePanel.open) {
      const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (currentTab?.id) {
        await chrome.sidePanel.open({ tabId: currentTab.id });
      }
    } else {
      window.close();
    }
  };

  return (
    <div className="w-72 bg-slate-900 text-slate-100 p-4 font-sans select-none border border-slate-800">
      <div className="flex items-center space-x-2.5 mb-3">
        <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white text-xs">
          HF
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">Handsfree</h2>
          <p className="text-[11px] text-slate-400">Motion & Voice Browser Agent</p>
        </div>
      </div>

      <div className="bg-slate-800/80 rounded-lg p-2.5 border border-slate-700/80 text-xs text-slate-300 space-y-1.5 mb-3">
        <div className="flex justify-between">
          <span className="text-slate-400">Status:</span>
          <span className="text-emerald-400 font-medium">Ready</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Supported:</span>
          <span>Head & Hand tracking</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Languages:</span>
          <span>EN, HI, MR</span>
        </div>
      </div>

      <button
        onClick={handleOpenSidepanel}
        className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow transition-colors flex items-center justify-center space-x-1.5"
      >
        <span>Open Sidepanel Control</span>
        <span>→</span>
      </button>
    </div>
  );
};
