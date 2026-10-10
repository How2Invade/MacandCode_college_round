import re

with open('src/sidepanel/Sidepanel.tsx', 'r') as f:
    content = f.read()

# Fix Theme Icon
theme_icon_target = r"(\<button\s*onClick=\{[^}]+\}\s*className=\"w-\[36px\] h-\[36px\] rounded-full bg-gray-50 hover:bg-gray-100 dark:bg-white/5 dark:hover:bg-white/10 transition flex items-center justify-center text-hf-text-secondary dark:text-hf-dark-text-secondary\"\s*\>)\s*\<svg[^\>]+\>[^\<]+\</svg\>\s*(\</button\>)"
theme_icon_replacement = r"""\1
              {theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? (
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><title>Switch to light mode</title><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
              ) : (
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><title>Switch to dark mode</title><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
              )}
            \2"""
# Only replace the first occurrence (which is the theme toggle)
content = content[:10000] + re.sub(theme_icon_target, theme_icon_replacement, content[10000:], count=0)
# Wait, let's just do a specific replacement. I'll use multi_replace_file_content for the theme icon.
