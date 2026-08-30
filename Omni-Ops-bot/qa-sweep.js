// qa-sweep.js
const fs = require("fs");
const path = require("path");

const FORBIDDEN_PATTERNS = [
  { regex: /Coding Hub/gi, label: "Old Branding (Coding Hub)" },
  { regex: /Logiscool/gi, label: "Old Branding (Logiscool)" },
  { regex: /Qatar/gi, label: "Regional Hardcode (Qatar)" },
  { regex: /QAR/g, label: "Regional Currency (QAR)" },
  { regex: /Asia\/Qatar/g, label: "Regional Timezone" },
  { regex: /discordId/g, label: "Platform Lock (discordId) -> use externalId" },
  { regex: /Director/g, label: "Old Role (Director) -> use Admin" },
  { regex: /Operations Manager/g, label: "Old Role (Operations Manager) -> use Manager" },
  { regex: /\bclass(?:es)?\b/gi, label: "Old Terminology (class/classes) -> use appointment" },
  { regex: /\bbill(?:s)?\b/gi, label: "Old Terminology (bill/bills) -> use invoice" },
  { regex: /[\u0600-\u06FF]/g, label: "Arabic Characters" },
];

const EXCLUDE_DIRS = ["node_modules", ".git", "logs"];

function scanDirectory(dir) {
  let warnings = 0;
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch (e) {
    return 0;
  }

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (!EXCLUDE_DIRS.includes(file)) {
        warnings += scanDirectory(fullPath);
      }
    } else if (file.endsWith(".js") || file.endsWith(".json") || file.endsWith(".md")) {
      const content = fs.readFileSync(fullPath, "utf8");
      const lines = content.split("\n");

      lines.forEach((line, index) => {
        for (const pattern of FORBIDDEN_PATTERNS) {
          if (pattern.regex.global) pattern.regex.lastIndex = 0;
          if (pattern.regex.test(line)) {
            console.warn(`⚠️  [${pattern.label}] in ${fullPath}:${index + 1}`);
            console.warn(`   ${line.trim()}\n`);
            warnings++;
          }
        }
      });
    }
  }
  return warnings;
}

console.log("🔍 Starting Omni-Ops QA Sweep...\n");
const srcPath = path.join(__dirname, "src");
const totalWarnings = scanDirectory(srcPath);
console.log(`\n✅ Sweep complete. Found ${totalWarnings} potential leftover references.`);
