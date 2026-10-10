import re

with open('src/sidepanel/Sidepanel.tsx', 'r') as f:
    content = f.read()

liquid_glass_classes = "bg-gradient-to-br from-[#FFFEFC]/80 to-[#F7F3EC]/60 dark:from-[#23252A]/80 dark:to-[#1A1B20]/60 backdrop-blur-md border border-white/60 dark:border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.8),0_2px_12px_rgba(0,0,0,0.03)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_2px_12px_rgba(0,0,0,0.2)]"

target_class = r"bg-hf-card dark:bg-hf-dark-card rounded-3xl p-[4-5] shadow-\[0_2px_12px_rgba\(0,0,0,0\.03\)\] border border-hf-border dark:border-hf-dark-border"

# We replace any exact matching block with our liquid glass.
def replace_func(match):
    # Keep the rounding and padding, replace the background/border/shadow.
    # The regex matched the whole string. We need to preserve the padding amount.
    original = match.group(0)
    if 'p-5' in original:
        return f"{liquid_glass_classes} rounded-3xl p-5"
    else:
        return f"{liquid_glass_classes} rounded-3xl p-4"

content = re.sub(target_class, replace_func, content)

# Also fix the top level wrapper layout if needed, though they just wanted selective application.
# "Keep the camera preview, Start/Stop controls, approval actions, and task status legible and practical."
# I'll let the rest remain.

with open('src/sidepanel/Sidepanel.tsx', 'w') as f:
    f.write(content)
