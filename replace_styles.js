const fs = require('fs');
let content = fs.readFileSync('src/sidepanel/Sidepanel.tsx', 'utf8');

// Global replacements for colors
content = content.replace(/bg-gray-50 dark:bg-\[\#1e1e20\]/g, "bg-hf-ivory dark:bg-hf-dark-bg");
content = content.replace(/bg-white dark:bg-\[\#27272a\]/g, "bg-hf-card dark:bg-hf-dark-card");
content = content.replace(/border-black\/\[0.04\]|border-black\/5/g, "border-hf-border dark:border-hf-dark-border");
content = content.replace(/text-gray-900/g, "text-hf-text-primary dark:text-hf-dark-text-primary");
content = content.replace(/text-gray-800/g, "text-hf-text-primary dark:text-hf-dark-text-primary");
content = content.replace(/text-gray-700/g, "text-hf-text-secondary dark:text-hf-dark-text-secondary");
content = content.replace(/text-gray-600/g, "text-hf-text-secondary dark:text-hf-dark-text-secondary");
content = content.replace(/text-gray-500/g, "text-hf-text-secondary dark:text-hf-dark-text-secondary");

fs.writeFileSync('src/sidepanel/Sidepanel.tsx', content);
