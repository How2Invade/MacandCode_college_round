import re

with open('src/sidepanel/Sidepanel.tsx', 'r') as f:
    content = f.read()

# 1. Tracking selector + Dictionary
selector_target = r"(\{\/\* 2\. Tracking Mode Selector \*\/\}\n\s*\<div className=\"flex items-center justify-between shrink-0 px-1\"\>.*?)\{\/\* 3\. Live Camera Preview Card \*\/\}"

selector_replacement = """{/* 2. Tracking Mode & Dictionary */}
          <div className="flex flex-col bg-white dark:bg-white/5 border border-hf-border dark:border-white/10 rounded-2xl p-2 space-y-2 shrink-0 shadow-sm">
            <div className="flex items-center justify-between px-1">
              <div className="flex bg-[#e8e4db] dark:bg-white/10 rounded-full p-[3px] space-x-1 shadow-inner">
                <button onClick={() => handleModeChange('hand')} className={`flex items-center space-x-1.5 px-3 py-1.5 text-[13px] font-semibold rounded-full transition-all ${mode === 'hand' ? 'bg-white dark:bg-[#323235] text-hf-teal shadow-sm border border-hf-border dark:border-hf-dark-border dark:border-white/10' : 'text-hf-text-secondary dark:text-hf-dark-text-secondary dark:text-gray-300 hover:text-hf-text-primary dark:text-hf-dark-text-primary'}`}>
                  <svg className="w-3.5 h-3.5 opacity-80" fill="currentColor" viewBox="0 0 24 24"><path d="M21.2 9.5c-.3-.3-.7-.5-1.1-.6-.4-.1-.8-.1-1.2 0-.2 0-.5.1-.7.2l-.7-3.2c-.1-.5-.4-.9-.9-1.2-.5-.2-1-.3-1.5-.1-.5.1-.9.5-1.2 1-.2.4-.2.8-.2 1.3V9c-.1-.2-.3-.5-.5-.6-.3-.2-.6-.3-1-.3-.4 0-.8.1-1.1.4-.4.3-.6.7-.6 1.1v3.2L9.3 12c-.3-.2-.7-.3-1-.3-.4 0-.8.1-1.1.4-.5.4-.7 1-.5 1.5l1.6 5.8c.4 1.5 1.8 2.5 3.3 2.5h2.1c2 0 3.8-1.2 4.6-3L21 12.3c.4-1 .3-2-.2-2.8z"/></svg>
                  <span>{t('hand', interfaceLanguage)}</span>
                </button>
                <button onClick={() => handleModeChange('head')} className={`flex items-center space-x-1.5 px-3 py-1.5 text-[13px] font-semibold rounded-full transition-all ${mode === 'head' ? 'bg-white dark:bg-[#323235] text-hf-teal shadow-sm border border-hf-border dark:border-hf-dark-border dark:border-white/10' : 'text-hf-text-secondary dark:text-hf-dark-text-secondary dark:text-gray-300 hover:text-hf-text-primary dark:text-hf-dark-text-primary'}`}>
                  <svg className="w-3.5 h-3.5 opacity-80" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C8.1 2 5 5.1 5 9c0 2.4 1.2 4.5 3 5.7V17c0 .6.4 1 1 1h6c.6 0 1-.4 1-1v-2.3c1.8-1.2 3-3.3 3-5.7 0-3.9-3.1-7-7-7zm0 2c2.8 0 5 2.2 5 5 0 2-.1 4-2 5v2H9v-2c-1.9-1-2-3-2-5 0-2.8 2.2-5 5-5z"/></svg>
                  <span>{t('head', interfaceLanguage)}</span>
                </button>
              </div>
              
              <div className="flex items-center space-x-1.5">
                 <span className={`w-2 h-2 rounded-full ${trackingStatus.state === 'active' ? 'bg-hf-teal' : trackingStatus.state === 'error' ? 'bg-hf-red' : 'bg-gray-300'}`}></span>
                 <span className="text-[12px] font-semibold text-hf-text-secondary dark:text-hf-dark-text-secondary dark:text-gray-200">{t('tracking', interfaceLanguage)}</span>
              </div>
            </div>
            
            <div className="flex justify-center pt-2 pb-1 border-t border-hf-border dark:border-white/10">
              {mode === 'hand' ? (
                <div className="flex justify-around w-full max-w-sm text-[11px] text-hf-text-secondary dark:text-hf-dark-text-secondary">
                  <div className="flex items-center space-x-1"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">Point:</span><span>Move</span></div>
                  <div className="flex items-center space-x-1"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">Pinch:</span><span>Click</span></div>
                  <div className="flex items-center space-x-1"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">Fist:</span><span>Drag</span></div>
                  <div className="flex items-center space-x-1"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">Palm:</span><span>Reset</span></div>
                </div>
              ) : (
                <div className="flex justify-around w-full max-w-sm text-[11px] text-hf-text-secondary dark:text-hf-dark-text-secondary">
                  <div className="flex items-center space-x-1"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">Look:</span><span>Move</span></div>
                  <div className="flex items-center space-x-1"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">Nod:</span><span>Click</span></div>
                  <div className="flex items-center space-x-1"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">Shake:</span><span>Cancel</span></div>
                  <div className="flex items-center space-x-1"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">Dwell:</span><span>Hover/Click</span></div>
                </div>
              )}
            </div>
          </div>

          {/* 3. Live Camera Preview */}
"""
content = re.sub(selector_target, selector_replacement, content, flags=re.DOTALL)

# 2. Camera Card simplification
camera_target = r"(\{\/\* 3\. Live Camera Preview \*\/\}\n\s*)\<div className=\"bg-hf-card dark:bg-hf-dark-card rounded-3xl p-3 shadow-\[0_2px_12px_rgba\(0,0,0,0\.03\)\] border border-hf-border dark:border-hf-dark-border flex flex-col space-y-3 shrink-0\"\>\n\s*\<div className=\"relative w-full aspect-\[4/3\] bg-black/5 dark:bg-black/20 rounded-2xl overflow-hidden flex items-center justify-center\"\>"
camera_replacement = r"""\1<div className="flex flex-col space-y-3 shrink-0">
            <div className="relative w-full aspect-[4/3] bg-black/5 dark:bg-black/20 rounded-2xl overflow-hidden flex items-center justify-center shadow-sm border border-hf-border dark:border-white/10">"""
content = re.sub(camera_target, camera_replacement, content)

with open('src/sidepanel/Sidepanel.tsx', 'w') as f:
    f.write(content)
