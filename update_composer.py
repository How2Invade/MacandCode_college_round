import re

with open('src/sidepanel/Sidepanel.tsx', 'r') as f:
    content = f.read()

# Voice Command Composer Replacement
composer_target = r"\<div className=\"relative w-full h-\[120px\] bg-\[\#fcfcfc\].*?\</button\>\n\s*\</div\>\n\s*\{voiceState === 'error' && voiceError && \(\n\s*\<p className=\"text-\[11px\] text-red-500 font-medium\"\>\{voiceError\}\</p\>\n\s*\)\}"
# Wait, my sed output:
#              <div className="relative w-full h-[120px] bg-[#fcfcfc] dark:bg-[#323235] border border-gray-200 dark:border-white/10 rounded-2xl flex flex-col p-4 transition-colors">
# ...
#              {voiceState === 'error' && voiceError && (
#                <p className="text-[11px] text-red-500 font-medium">{voiceError}</p>
#              )}

composer_replacement = """<div className="flex flex-col w-full h-[160px] bg-hf-ivory dark:bg-hf-dark-bg border border-hf-border dark:border-white/10 rounded-2xl p-3 overflow-y-auto space-y-2">
                {conversation.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center space-y-2 opacity-50">
                    <span className="text-gray-400 text-[14px] font-medium tracking-tight">{t('sayCommand', interfaceLanguage)}</span>
                  </div>
                ) : (
                  conversation.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`px-3 py-2 rounded-2xl max-w-[85%] text-[13px] ${msg.role === 'user' ? 'bg-hf-blue/10 text-hf-blue dark:bg-hf-blue/20 dark:text-hf-blue rounded-tr-sm' : 'bg-white dark:bg-white/5 text-hf-text-primary dark:text-white rounded-tl-sm shadow-sm'}`}>
                         {msg.text}
                      </div>
                    </div>
                  ))
                )}
             </div>

             <div className="flex items-center space-x-2">
               {isSpeaking && (
                 <button onClick={stopSpeaking} className="p-2 bg-yellow-100 text-yellow-600 rounded-full hover:bg-yellow-200">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>
                 </button>
               )}
               <button onClick={toggleListen} className={`w-[40px] h-[40px] shrink-0 rounded-full flex items-center justify-center transition shadow-sm ${voiceState === 'listening' ? 'bg-hf-red text-white animate-pulse shadow-red-500/30' : 'bg-hf-teal text-white hover:bg-hf-teal/90'}`}>
                 <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
               </button>
               <input 
                 type="text" 
                 value={inputText}
                 onChange={(e) => setInputText(e.target.value)}
                 onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                 placeholder={t('typeRequest', interfaceLanguage)} 
                 className="flex-1 min-w-0 bg-hf-ivory dark:bg-white/5 text-[13px] px-3 py-2.5 rounded-xl border border-hf-border dark:border-white/10 outline-none placeholder:text-gray-400 font-medium dark:text-white"
               />
               <button onClick={() => handleSendMessage()} disabled={!inputText.trim() || assistantState === 'thinking'} className="w-[40px] h-[40px] shrink-0 flex items-center justify-center text-gray-400 hover:text-hf-text-primary dark:text-hf-dark-text-primary transition disabled:opacity-30 bg-hf-ivory dark:bg-white/5 rounded-xl border border-hf-border dark:border-white/10">
                 <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
               </button>
             </div>
             
             <div className="pt-1 flex justify-center">
                <button onClick={handleReadPage} className="flex items-center space-x-1.5 text-[12px] font-semibold text-hf-teal hover:text-hf-teal/80 transition bg-hf-teal/10 px-3 py-1.5 rounded-lg">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path></svg>
                  <span>Read Page Aloud</span>
                </button>
             </div>

             {voiceState === 'error' && voiceError && (
               <p className="text-[11px] text-red-500 font-medium">{voiceError}</p>
             )}"""

content = re.sub(r'\<div className="relative w-full h-\[120px\] bg-\[\#fcfcfc\].*?\{voiceState === \'error\' && voiceError && \(\n\s*\<p className="text-\[11px\] text-red-500 font-medium"\>\{voiceError\}\</p\>\n\s*\)\}', composer_replacement, content, flags=re.DOTALL)

with open('src/sidepanel/Sidepanel.tsx', 'w') as f:
    f.write(content)
