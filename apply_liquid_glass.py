import re

with open('src/sidepanel/Sidepanel.tsx', 'r') as f:
    content = f.read()

liquid_glass_classes = "bg-gradient-to-br from-[#FFFEFC]/80 to-[#F7F3EC]/60 dark:from-[#23252A]/80 dark:to-[#1A1B20]/60 backdrop-blur-md border border-white/60 dark:border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.8),0_2px_12px_rgba(0,0,0,0.03)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_2px_12px_rgba(0,0,0,0.2)]"

# 1. Header
header_target = r"\<div className=\"flex items-center justify-between shrink-0\"\>"
header_replacement = r"""<div className="flex items-center justify-between shrink-0 bg-gradient-to-r from-white/40 to-white/20 dark:from-[#23252A]/40 dark:to-[#1A1B20]/20 backdrop-blur-md border-b border-white/50 dark:border-white/5 shadow-[inset_0_-1px_1px_rgba(255,255,255,0.3)] dark:shadow-none p-3 -mx-4 -mt-4 mb-4 rounded-b-2xl">"""
# Actually, the header is just a flex div. It might be better to just apply it directly.
content = re.sub(header_target, header_replacement, content)

# 2. Theme Toggle
theme_toggle_target = r"className=\"w-\[36px\] h-\[36px\] rounded-full bg-gray-50 hover:bg-gray-100 dark:bg-white/5 dark:hover:bg-white/10 transition flex items-center justify-center text-hf-text-secondary dark:text-hf-dark-text-secondary\""
theme_toggle_replacement = r"""className="w-[36px] h-[36px] rounded-full bg-gradient-to-tr from-white/60 to-white/30 dark:from-white/10 dark:to-white/5 backdrop-blur-sm border border-white/50 dark:border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_1px_2px_rgba(0,0,0,0.05)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] hover:scale-105 transition flex items-center justify-center text-hf-text-secondary dark:text-hf-dark-text-secondary" """
content = re.sub(theme_toggle_target, theme_toggle_replacement, content)

# 3. Hand/Head Selector
selector_target = r"\<div className=\"flex flex-col bg-white dark:bg-white/5 border border-hf-border dark:border-white/10 rounded-2xl p-2 space-y-2 shrink-0 shadow-sm\"\>"
selector_replacement = f"""<div className="flex flex-col {liquid_glass_classes} rounded-2xl p-2 space-y-2 shrink-0">"""
content = re.sub(selector_target, selector_replacement, content)

# 4. AI Assistant Composer area
composer_target = r"\<div className=\"bg-hf-card dark:bg-hf-dark-card rounded-3xl p-4 shadow-\[0_2px_12px_rgba\(0,0,0,0\.03\)\] border border-hf-border dark:border-hf-dark-border shrink-0 space-y-4\"\>"
composer_replacement = f"""<div className="{liquid_glass_classes} rounded-3xl p-4 shrink-0 space-y-4">"""
content = re.sub(composer_target, composer_replacement, content)

# 5. Microphone button
mic_target = r"className=\{\`w-\[40px\] h-\[40px\] shrink-0 rounded-full flex items-center justify-center transition shadow-sm \$\{voiceState === 'listening' \? 'bg-hf-red text-white animate-pulse shadow-red-500/30' : 'bg-hf-teal text-white hover:bg-hf-teal/90'\}\`\}"
mic_replacement = r"""className={`w-[40px] h-[40px] shrink-0 rounded-full flex items-center justify-center transition shadow-[inset_0_1px_1px_rgba(255,255,255,0.4),0_2px_5px_rgba(0,0,0,0.1)] ${voiceState === 'listening' ? 'bg-gradient-to-br from-red-400 to-red-600 text-white animate-pulse' : 'bg-gradient-to-br from-[#238F83] to-[#1A6B62] text-white hover:scale-105'}`}"""
content = re.sub(mic_target, mic_replacement, content)

# 6. Active Task Card
active_task_target = r"\<div className=\"bg-hf-card dark:bg-hf-dark-card rounded-3xl p-4 shadow-\[0_2px_12px_rgba\(0,0,0,0\.03\)\] border border-hf-border dark:border-hf-dark-border flex-1 flex flex-col min-h-0\"\>"
active_task_replacement = f"""<div className="{liquid_glass_classes} rounded-3xl p-4 flex-1 flex flex-col min-h-0">"""
content = re.sub(active_task_target, active_task_replacement, content)

# 7. Transcript Area Surface
transcript_target = r"\<div className=\"flex flex-col w-full h-\[160px\] bg-hf-ivory dark:bg-hf-dark-bg border border-hf-border dark:border-white/10 rounded-2xl p-3 overflow-y-auto space-y-2\"\>"
transcript_replacement = r"""<div className="flex flex-col w-full h-[160px] bg-black/5 dark:bg-black/20 shadow-inner rounded-2xl p-3 overflow-y-auto space-y-2">"""
content = re.sub(transcript_target, transcript_replacement, content)

# 8. User / Assistant Bubble
user_bubble_target = r"bg-hf-blue/10 text-hf-blue dark:bg-hf-blue/20 dark:text-hf-blue rounded-tr-sm"
user_bubble_replacement = r"bg-gradient-to-br from-blue-500/10 to-blue-500/5 backdrop-blur-sm border border-blue-500/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] text-blue-700 dark:text-blue-300 rounded-tr-sm"
content = re.sub(user_bubble_target, user_bubble_replacement, content)

ai_bubble_target = r"bg-white dark:bg-white/5 text-hf-text-primary dark:text-white rounded-tl-sm shadow-sm"
ai_bubble_replacement = r"bg-gradient-to-br from-white/80 to-white/40 dark:from-white/10 dark:to-white/5 backdrop-blur-sm border border-white/50 dark:border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_1px_2px_rgba(0,0,0,0.05)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] text-hf-text-primary dark:text-white rounded-tl-sm"
content = re.sub(ai_bubble_target, ai_bubble_replacement, content)

with open('src/sidepanel/Sidepanel.tsx', 'w') as f:
    f.write(content)
