import re

with open('src/sidepanel/Sidepanel.tsx', 'r') as f:
    content = f.read()

dictionary_jsx = """
          </div>

          <div className="flex bg-hf-card dark:bg-hf-dark-card border border-hf-border dark:border-hf-dark-border rounded-2xl p-3 shrink-0">
            {mode === 'hand' ? (
              <div className="flex justify-around w-full text-[12px] text-hf-text-secondary dark:text-hf-dark-text-secondary">
                <div className="flex items-center space-x-1.5"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">Point:</span><span>Move</span></div>
                <div className="flex items-center space-x-1.5"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">Pinch:</span><span>Click</span></div>
                <div className="flex items-center space-x-1.5"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">Fist:</span><span>Drag</span></div>
                <div className="flex items-center space-x-1.5"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">Palm:</span><span>Reset</span></div>
              </div>
            ) : (
              <div className="flex justify-around w-full text-[12px] text-hf-text-secondary dark:text-hf-dark-text-secondary">
                <div className="flex items-center space-x-1.5"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">Look:</span><span>Move</span></div>
                <div className="flex items-center space-x-1.5"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">Nod:</span><span>Click</span></div>
                <div className="flex items-center space-x-1.5"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">Shake:</span><span>Cancel</span></div>
                <div className="flex items-center space-x-1.5"><span className="font-bold text-hf-text-primary dark:text-hf-dark-text-primary">Dwell:</span><span>Hover/Click</span></div>
              </div>
            )}
          </div>
"""

# Find the end of Tracking Mode Selector
# </div> (the one matching <div className="flex items-center justify-between shrink-0 px-1">)
target = r'(\<span className="text-\[13px\] font-semibold text-hf-text-secondary dark:text-hf-dark-text-secondary dark:text-gray-200">\{t\(\'tracking\', interfaceLanguage\)\}\</span\>\n            \</div\>\n          \</div\>)'
content = re.sub(target, r'\1' + dictionary_jsx, content)

with open('src/sidepanel/Sidepanel.tsx', 'w') as f:
    f.write(content)
