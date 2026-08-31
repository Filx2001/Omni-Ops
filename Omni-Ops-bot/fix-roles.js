const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src');
const replacements = [
  { regex: /"Director"/g, replace: '"Admin"' },
  { regex: /"Operations Manager"/g, replace: '"Manager"' },
  { regex: /'Director'/g, replace: "'Admin'" },
  { regex: /'Operations Manager'/g, replace: "'Manager'" },
  { regex: /isDirector/g, replace: 'isAdmin' },
  { regex: /set-director/g, replace: 'set-admin' },
  { regex: /\bDirector\b/g, replace: 'Admin' },
  { regex: /\bOperations Manager\b/g, replace: 'Manager' },
];

function walk(d) {
  fs.readdirSync(d).forEach(f => {
    const fullPath = path.join(d, f);
    if (fs.statSync(fullPath).isDirectory()) {
      walk(fullPath);
    } else if (fullPath.endsWith('.js')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let original = content;
      replacements.forEach(r => { content = content.replace(r.regex, r.replace); });
      if (content !== original) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`✅ Updated: ${fullPath.replace(__dirname, '')}`);
      }
    }
  });
}

walk(dir);
console.log('🎉 Done! All roles updated. You can delete this script now.');