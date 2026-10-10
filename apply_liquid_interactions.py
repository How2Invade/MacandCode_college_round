import re

with open('src/sidepanel/Sidepanel.tsx', 'r') as f:
    content = f.read()

# 1. Selector Slide Transition
selector_target = r"\<div className=\"relative flex bg-gradient-to-b from-gray-200/50 to-gray-100/50 dark:from-white/5 dark:to-white/10 rounded-full p-\[3px\] shadow-\[inset_0_2px_4px_rgba\(0,0,0,0\.05\)\] border border-black/5 dark:border-white/5\" \>\n\s*\<button onClick=\{\(\) =\> handleModeChange\('hand'\)\}.*?\</button\>\n\s*\<button onClick=\{\(\) =\> handleModeChange\('head'\)\}.*?\</button\>\n\s*\</div\>"
selector_new = r"""<div className="relative flex bg-gradient-to-b from-gray-200/50 to-gray-100/50 dark:from-white/5 dark:to-white/10 rounded-full p-[3px] shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)] border border-black/5 dark:border-white/5" >
                <div 
                  className="absolute top-[3px] bottom-[3px] w-[calc(50%-3px)] bg-gradient-to-br from-white/90 to-white/70 dark:from-[#3A3C42]/80 dark:to-[#2A2B30]/80 shadow-[inset_0_1px_2px_rgba(255,255,255,0.9),0_2px_8px_rgba(0,0,0,0.05)] border border-white dark:border-white/20 rounded-full transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
                  style={{ transform: mode === 'hand' ? 'translateX(0)' : 'translateX(100%)' }}
                />
                <button onClick={() => handleModeChange('hand')} className={`relative z-10 flex flex-1 items-center justify-center space-x-1.5 px-3 py-1.5 text-[13px] font-semibold rounded-full transition-colors duration-300 ${mode === 'hand' ? 'text-hf-teal' : 'text-hf-text-secondary dark:text-hf-dark-text-secondary hover:text-hf-text-primary dark:hover:text-hf-dark-text-primary'}`}>
                  <svg className="w-3.5 h-3.5 opacity-80" fill="currentColor" viewBox="0 0 24 24"><path d="M21.2 9.5c-.3-.3-.7-.5-1.1-.6-.4-.1-.8-.1-1.2 0-.2 0-.5.1-.7.2l-.7-3.2c-.1-.5-.4-.9-.9-1.2-.5-.2-1-.3-1.5-.1-.5.1-.9.5-1.2 1-.2.4-.2.8-.2 1.3V9c-.1-.2-.3-.5-.5-.6-.3-.2-.6-.3-1-.3-.4 0-.8.1-1.1.4-.4.3-.6.7-.6 1.1v3.2L9.3 12c-.3-.2-.7-.3-1-.3-.4 0-.8.1-1.1.4-.5.4-.7 1-.5 1.5l1.6 5.8c.4 1.5 1.8 2.5 3.3 2.5h2.1c2 0 3.8-1.2 4.6-3L21 12.3c.4-1 .3-2-.2-2.8z"/></svg>
                  <span>{t('hand', interfaceLanguage)}</span>
                </button>
                <button onClick={() => handleModeChange('head')} className={`relative z-10 flex flex-1 items-center justify-center space-x-1.5 px-3 py-1.5 text-[13px] font-semibold rounded-full transition-colors duration-300 ${mode === 'head' ? 'text-hf-teal' : 'text-hf-text-secondary dark:text-hf-dark-text-secondary hover:text-hf-text-primary dark:hover:text-hf-dark-text-primary'}`}>
                  <svg className="w-3.5 h-3.5 opacity-80" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C8.1 2 5 5.1 5 9c0 2.4 1.2 4.5 3 5.7V17c0 .6.4 1 1 1h6c.6 0 1-.4 1-1v-2.3c1.8-1.2 3-3.3 3-5.7 0-3.9-3.1-7-7-7zm0 2c2.8 0 5 2.2 5 5 0 2-.1 4-2 5v2H9v-2c-1.9-1-2-3-2-5 0-2.8 2.2-5 5-5z"/></svg>
                  <span>{t('head', interfaceLanguage)}</span>
                </button>
              </div>"""

content = re.sub(selector_target, selector_new, content, flags=re.DOTALL)

# 2. Buttons
start_btn = r"className=\"flex-1 h-\[48px\] bg-\[\#fdfbf7\] dark:bg-\[\#27272a\] hover:bg-gray-50 dark:hover:bg-\[\#3f3f46\] border border-\[\#10b981\] dark:border-\[\#10b981\]/50 text-\[\#27272a\] dark:text-white rounded-xl font-bold tracking-wide transition active:scale-\[0\.98\] flex items-center justify-center space-x-1\.5 shadow-sm\""
start_btn_new = r"""className="flex-1 h-[48px] bg-gradient-to-br from-white/90 to-white/60 dark:from-[#2A2B30]/80 dark:to-[#1A1B20]/80 backdrop-blur-md hover:from-white hover:to-white/80 dark:hover:from-[#3A3C42]/80 border border-[#10b981]/40 dark:border-[#10b981]/30 text-hf-text-primary dark:text-white rounded-xl font-bold tracking-wide transition-all duration-300 ease-out active:scale-[0.98] flex items-center justify-center space-x-1.5 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8),0_2px_8px_rgba(16,185,129,0.1)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_2px_8px_rgba(16,185,129,0.05)]" """
content = re.sub(start_btn, start_btn_new, content)

# Since the stop button didn't match perfectly before, we just use regex matching its core structure
stop_btn = r"className=\"flex-1 h-\[48px\] bg-hf-card dark:bg-hf-dark-card hover:bg-\[\#fef2f2\] dark:hover:bg-\[\#451a1a\] border border-red-500/50 dark:border-red-500/50 text-\[\#27272a\] dark:text-white rounded-xl font-bold flex items-center justify-center space-x-1\.5 transition active:scale-\[0\.98\] shadow-sm\""
# Wait, it might have been changed in the previous pass because it contains bg-hf-card dark:bg-hf-dark-card rounded-3xl ? No, it has rounded-xl.
stop_btn_alt = r"className=\"flex-1 h-\[48px\] bg-[^\"]*hover:bg-\[\#fef2f2\] dark:hover:bg-\[\#451a1a\] border border-red-500/50 dark:border-red-500/50 text-\[\#27272a\] dark:text-white rounded-xl font-bold flex items-center justify-center space-x-1\.5 transition active:scale-\[0\.98\] shadow-sm\""
stop_btn_new = r"""className="flex-1 h-[48px] bg-gradient-to-br from-white/60 to-white/30 dark:from-[#2A2B30]/50 dark:to-[#1A1B20]/50 backdrop-blur-md hover:from-red-50/80 hover:to-red-50/50 dark:hover:from-red-900/20 dark:hover:to-red-900/10 border border-red-500/30 text-hf-text-primary dark:text-white rounded-xl font-bold flex items-center justify-center space-x-1.5 transition-all duration-300 ease-out active:scale-[0.98] shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),0_2px_8px_rgba(0,0,0,0.02)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]" """
content = re.sub(stop_btn, stop_btn_new, content)
content = re.sub(stop_btn_alt, stop_btn_new, content) # Catching if it was missed or changed

test_btn = r"className=\"flex-1 h-\[36px\] bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-white/10 rounded-lg font-bold tracking-wide transition flex items-center justify-center shadow-sm\""
test_btn_new = r"""className="flex-1 h-[36px] bg-gradient-to-br from-white/40 to-white/10 dark:from-white/5 dark:to-white/5 backdrop-blur-sm hover:from-white/60 hover:to-white/30 dark:hover:from-white/10 dark:hover:to-white/5 text-gray-600 dark:text-gray-400 border border-white/50 dark:border-white/10 rounded-lg font-bold tracking-wide transition-all duration-300 ease-out flex items-center justify-center shadow-[inset_0_1px_1px_rgba(255,255,255,0.5)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)]" """
content = re.sub(test_btn, test_btn_new, content)

with open('src/sidepanel/Sidepanel.tsx', 'w') as f:
    f.write(content)

