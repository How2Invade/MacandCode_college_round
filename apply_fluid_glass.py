import re

with open('src/sidepanel/Sidepanel.tsx', 'r') as f:
    content = f.read()

# 1. Mode Selector Segmented Control
mode_sel_outer = r"className=\"flex bg-\[\#e8e4db\] dark:bg-white/10 rounded-full p-\[3px\] space-x-1 shadow-inner\""
mode_sel_outer_new = r"""className="relative flex bg-gradient-to-b from-gray-200/50 to-gray-100/50 dark:from-white/5 dark:to-white/10 rounded-full p-[3px] shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)] border border-black/5 dark:border-white/5" """
content = re.sub(mode_sel_outer, mode_sel_outer_new, content)

mode_btn_active = r"bg-white dark:bg-\[\#323235\] text-hf-teal shadow-sm border border-hf-border dark:border-hf-dark-border dark:border-white/10"
mode_btn_active_new = r"bg-gradient-to-br from-white/90 to-white/70 dark:from-[#3A3C42]/80 dark:to-[#2A2B30]/80 text-hf-teal shadow-[inset_0_1px_2px_rgba(255,255,255,0.9),0_2px_8px_rgba(0,0,0,0.05)] border border-white dark:border-white/20 z-10"
content = re.sub(mode_btn_active, mode_btn_active_new, content)

# 2. Header
header_class = r"bg-gradient-to-r from-white/40 to-white/20 dark:from-\[\#23252A\]/40 dark:to-\[\#1A1B20\]/20 backdrop-blur-md border-b border-white/50 dark:border-white/5 shadow-\[inset_0_-1px_1px_rgba\(255,255,255,0\.3\)\] dark:shadow-none"
header_class_new = r"bg-gradient-to-b from-white/60 to-white/30 dark:from-white/10 dark:to-white/5 backdrop-blur-lg border-b border-white/60 dark:border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_2px_10px_rgba(0,0,0,0.02)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_2px_10px_rgba(0,0,0,0.2)]"
content = re.sub(header_class, header_class_new, content)

# 3. Microphone Button
mic_class = r"bg-gradient-to-br from-red-400 to-red-600 text-white animate-pulse"
mic_class_new = r"bg-gradient-to-br from-red-400 to-red-600 text-white animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.5),inset_0_2px_4px_rgba(255,255,255,0.4)] border border-red-300/50"
content = re.sub(mic_class, mic_class_new, content)

mic_idle = r"bg-gradient-to-br from-\[\#238F83\] to-\[\#1A6B62\] text-white hover:scale-105"
mic_idle_new = r"bg-gradient-to-br from-[#238F83] to-[#1A6B62] text-white hover:scale-105 shadow-[0_2px_8px_rgba(35,143,131,0.3),inset_0_2px_4px_rgba(255,255,255,0.3)] border border-[#238F83]/50"
content = re.sub(mic_idle, mic_idle_new, content)

# 4. Theme Toggle Button
theme_toggle = r"bg-gradient-to-tr from-white/60 to-white/30 dark:from-white/10 dark:to-white/5 backdrop-blur-sm border border-white/50 dark:border-white/10 shadow-\[inset_0_1px_0_rgba\(255,255,255,0\.6\),0_1px_2px_rgba\(0,0,0,0\.05\)\] dark:shadow-\[inset_0_1px_0_rgba\(255,255,255,0\.1\)\] hover:scale-105 transition"
theme_toggle_new = r"bg-gradient-to-tr from-white/80 to-white/40 dark:from-white/10 dark:to-white/5 backdrop-blur-md border border-white/80 dark:border-white/20 shadow-[inset_0_2px_4px_rgba(255,255,255,0.8),0_2px_8px_rgba(0,0,0,0.03)] dark:shadow-[inset_0_1px_2px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.2)] hover:scale-105 hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] dark:hover:shadow-[0_4px_12px_rgba(255,255,255,0.05)] transition-all"
content = re.sub(theme_toggle, theme_toggle_new, content)

# 5. Fix remaining "bg-hf-card" for any buttons that were missed or adjust AI conversation bubble
ai_bubble_user = r"bg-gradient-to-br from-blue-500/10 to-blue-500/5 backdrop-blur-sm border border-blue-500/20 shadow-\[inset_0_1px_0_rgba\(255,255,255,0\.5\)\] text-blue-700 dark:text-blue-300 rounded-tr-sm"
ai_bubble_user_new = r"bg-gradient-to-br from-blue-500/15 to-blue-500/5 backdrop-blur-md border border-blue-500/30 shadow-[inset_0_1px_1px_rgba(255,255,255,0.6),0_2px_4px_rgba(59,130,246,0.05)] text-blue-800 dark:text-blue-200 rounded-tr-sm"
content = re.sub(ai_bubble_user, ai_bubble_user_new, content)

with open('src/sidepanel/Sidepanel.tsx', 'w') as f:
    f.write(content)
