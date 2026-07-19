const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SECTIONS = ['FE', 'PT', 'RE'];

function isRealImage(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(12);
  const n = fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);
  if (n < 4) return false;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png  = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const gif  = buf.slice(0, 3).toString('ascii') === 'GIF';
  const webp = buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP';
  return jpeg || png || gif || webp;
}

function parseYear(name) {
  const m4 = name.match(/\b(?:19|20)\d{2}\b/);
  if (m4) return parseInt(m4[0], 10);
  const m2 = name.match(/(?:FA|SP|SU|WI|FALL|SPRING|SUMMER)\s*[-_]?\s*(\d{2})(?!\d)/i);
  if (m2) return 2000 + parseInt(m2[1], 10);
  return 0;
}

const manifest = { generatedAt: new Date().toISOString(), sections: {} };
let totalExams = 0, totalQuestions = 0, droppedFiles = 0;

for (const section of SECTIONS) {
  const sectionDir = path.join(ROOT, section);
  if (!fs.existsSync(sectionDir)) continue;
  const exams = [];
  const examDirs = fs.readdirSync(sectionDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  for (const examName of examDirs) {
    const examDir = path.join(sectionDir, examName);
    const jpgs = fs.readdirSync(examDir)
      .filter(f => /\.jpe?g$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const questions = [];
    for (const f of jpgs) {
      const full = path.join(examDir, f);
      if (isRealImage(full)) {
        questions.push(f);
      } else {
        droppedFiles++;
      }
    }
    if (questions.length === 0) continue;
    exams.push({ id: `${section}/${examName}`, name: examName, year: parseYear(examName), count: questions.length, images: questions });
    totalExams++;
    totalQuestions += questions.length;
  }

  exams.sort((a, b) => b.year - a.year || a.name.localeCompare(b.name, undefined, { numeric: true }));
  manifest.sections[section] = exams;
}

const dataDir = path.join(ROOT, 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`Sections: ${SECTIONS.join(', ')}`);
console.log(`Exams: ${totalExams} | Questions: ${totalQuestions} | Dropped non-jpeg: ${droppedFiles}`);
console.log('Wrote data/manifest.json');
