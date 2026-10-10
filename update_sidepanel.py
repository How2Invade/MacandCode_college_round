import re

with open('src/sidepanel/Sidepanel.tsx', 'r') as f:
    content = f.read()

# Make sure we don't break logic, just classNames
# Dark mode bg-[#27272a] -> bg-hf-dark-card
content = re.sub(r'bg-white dark:bg-\[\#27272a\]', 'bg-hf-card dark:bg-hf-dark-card', content)
content = re.sub(r'bg-\[\#fbf6ec\] dark:bg-\[\#27272a\]', 'bg-hf-card dark:bg-hf-dark-card', content)
content = re.sub(r'bg-gray-50 dark:bg-white/5', 'bg-hf-ivory dark:bg-white/5', content)
content = re.sub(r'bg-gray-50 dark:bg-\[\#1e1e20\]', 'bg-hf-ivory dark:bg-hf-dark-bg', content)

# Background for main app wrapper
content = re.sub(r'bg-\[\#f6f4ee\] dark:bg-\[\#18181b\]', 'bg-hf-ivory dark:bg-hf-dark-bg', content)

# Borders
content = re.sub(r'border-black/\[0\.04\]|border-black/5', 'border-hf-border dark:border-hf-dark-border', content)
content = re.sub(r'border-\[\#e5e0d8\] dark:border-white/10', 'border-hf-border dark:border-hf-dark-border', content)

# Text
content = re.sub(r'text-gray-900', 'text-hf-text-primary dark:text-hf-dark-text-primary', content)
content = re.sub(r'text-\[\#18181b\] dark:text-\[\#f4f4f5\]', 'text-hf-text-primary dark:text-hf-dark-text-primary', content)

# Remove Pause button layout
pause_btn = r'<button onClick=\{trackingStatus.state === \'paused\' \? handleResume : handlePause\}[\s\S]*?Pause</span>\s*</button>'
content = re.sub(pause_btn, '', content)

with open('src/sidepanel/Sidepanel.tsx', 'w') as f:
    f.write(content)

