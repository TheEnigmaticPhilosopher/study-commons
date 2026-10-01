// Editorial links only. We do not mirror textbooks, exams or school materials.
const book = (slug, title) => ({ title, url: `https://openstax.org/details/books/${slug}`, source: 'OpenStax', rights: 'Free online textbook · see this edition’s license', type: 'Open reading' });
const site = (title, url, source, rights = 'Free access · publisher terms apply') => ({ title, url, source, rights, type: 'Reference' });
const ap = (slug, title = 'Official course archive: questions, scoring guides and sample responses') => ({ ...site(title, `https://apcentral.collegeboard.org/courses/${slug}/exam/past-exam-questions`, 'College Board', 'Free access · copyrighted, not public domain'), type: 'Past exam' });
// Exact PDF URLs verified on the official archive pages on October 1, 2026.
const examPdfs = {
  'calculus-ab': [
    ['2026 question paper (FRQ PDF)', 'https://apcentral.collegeboard.org/media/pdf/ap26-frq-calculus-ab.pdf'],
    ['2026 scoring guidelines (PDF)', 'https://apcentral.collegeboard.org/media/pdf/ap26-sg-calculus-ab.pdf'],
    ['2025 question paper (FRQ PDF)', 'https://apcentral.collegeboard.org/media/pdf/ap25-frq-calculus-ab.pdf'],
    ['2025 scoring guidelines (PDF)', 'https://apcentral.collegeboard.org/media/pdf/ap25-sg-calculus-ab.pdf'],
  ],
  chemistry: [
    ['2026 question paper (FRQ PDF)', 'https://apcentral.collegeboard.org/media/pdf/ap26-frq-chemistry.pdf'],
    ['2026 scoring guidelines (PDF)', 'https://apcentral.collegeboard.org/media/pdf/ap26-sg-chemistry.pdf'],
    ['2025 question paper (FRQ PDF)', 'https://apcentral.collegeboard.org/media/pdf/ap25-frq-chemistry.pdf'],
    ['2025 scoring guidelines (PDF)', 'https://apcentral.collegeboard.org/media/pdf/ap25-sg-chemistry.pdf'],
  ],
};
export const library = {
  calculus: [book('calculus-volume-1', 'Calculus Volume 1'), book('calculus-volume-2', 'Calculus Volume 2')],
  chemistry: [book('chemistry-2e', 'Chemistry 2e')],
  biology: [book('biology-ap-courses', 'Biology for AP Courses'), book('biology-2e', 'Biology 2e')],
  statistics: [book('introductory-statistics-2e', 'Introductory Statistics 2e')],
  algebra: [book('algebra-and-trigonometry-2e', 'Algebra and Trigonometry 2e')],
  economics: [book('principles-economics-3e', 'Principles of Economics 3e')],
  government: [book('american-government-4e', 'American Government 4e')],
  ushistory: [book('us-history', 'U.S. History')],
  history: [book('world-history-volume-1', 'World History Volume 1'), book('world-history-volume-2', 'World History Volume 2')],
  writing: [book('writing-guide', 'Writing Guide with Handbook'), site('Classic literature and primary texts', 'https://www.gutenberg.org/', 'Project Gutenberg', 'Mostly U.S. public-domain works · check each book and your jurisdiction')],
  latin: [site('Latin texts, vocabulary and commentary', 'https://dcc.dickinson.edu/', 'Dickinson College Commentaries', 'Free scholarly editions · see each edition’s license'), site('Greek and Roman texts and dictionaries', 'https://www.perseus.tufts.edu/hopper/', 'Perseus Digital Library', 'Free access · rights vary by text and edition')],
  philosophy: [site('Stanford Encyclopedia of Philosophy', 'https://plato.stanford.edu/', 'Stanford University'), book('introduction-philosophy', 'Introduction to Philosophy')],
  computing: [site('CS50: lectures and programming practice', 'https://cs50.harvard.edu/x/', 'Harvard University', 'Free course materials · course license applies')],
  religion: [site('New Testament history and literature: lectures', 'https://oyc.yale.edu/religious-studies/rlst-152', 'Open Yale Courses', 'Free lectures · historical and literary perspective; check course terms')],
  science: [book('biology-2e', 'Biology 2e'), book('chemistry-2e', 'Chemistry 2e'), book('college-physics-2e', 'College Physics 2e')],
};
export function subjectFor(name) {
  if (/calc/i.test(name)) return 'calculus';
  if (/chem/i.test(name)) return 'chemistry';
  if (/biolog/i.test(name)) return 'biology';
  if (/statistic/i.test(name)) return 'statistics';
  if (/algebra|math assessment/i.test(name)) return 'algebra';
  if (/econom/i.test(name)) return 'economics';
  if (/government/i.test(name)) return 'government';
  if (/APUSH|US History/i.test(name)) return 'ushistory';
  if (/history/i.test(name)) return 'history';
  if (/latin/i.test(name)) return 'latin';
  if (/philosophy/i.test(name)) return 'philosophy';
  if (/computer science/i.test(name)) return 'computing';
  if (/literature|composition|reading/i.test(name)) return 'writing';
  if (/STEM|olympiad/i.test(name)) return 'science';
  if (/New Testament/i.test(name)) return 'religion';
  return '';
}
export function resourcesFor(name) {
  const result = [...(library[subjectFor(name)] || [])];
  const matches = [
    [/AP (?:Calculus|Calc) AB/i, 'ap-calculus-ab'], [/AP (?:Calculus|Calc) BC/i, 'ap-calculus-bc'],
    [/AP Chemistry/i, 'ap-chemistry'], [/AP Biology/i, 'ap-biology'], [/AP Statistics/i, 'ap-statistics'],
    [/AP Language/i, 'ap-english-language-and-composition'], [/AP Literature/i, 'ap-english-literature-and-composition'],
    [/AP European History/i, 'ap-european-history'], [/AP US History|APUSH/i, 'ap-united-states-history'],
  ];
  for (const [pattern, slug] of matches) if (pattern.test(name)) result.unshift(ap(slug));
  if (/AP Computer Science/i.test(name)) result.unshift(ap('ap-computer-science-a', 'Computer Science A: past questions and scoring'), ap('ap-computer-science-principles', 'Computer Science Principles: past assessments and scoring'));
  if (/AP Economics/i.test(name)) result.unshift(ap('ap-macroeconomics', 'Macroeconomics: past questions and scoring'), ap('ap-microeconomics', 'Microeconomics: past questions and scoring'));
  const pdfSubject = /AP (?:Calculus|Calc) AB/i.test(name) ? 'calculus-ab' : /AP Chemistry/i.test(name) ? 'chemistry' : '';
  for (const [title, url] of examPdfs[pdfSubject] || []) result.push({ ...site(title, url, 'College Board', 'Official released material · copyrighted, free access'), type: 'Past exam' });
  return result;
}
const topic = (id, title, subject, match, bookSlug, page) => ({ id, title, subject, match,
  url: `https://openstax.org/books/${bookSlug}/pages/${page}` });
export const topics = [
  topic('related-rates', 'Related rates', 'calculus', /\brelated[ -]rates?\b/i, 'calculus-volume-1', '4-1-related-rates'),
  topic('chain-rule', 'Chain rule', 'calculus', /\bchain rule\b/i, 'calculus-volume-1', '3-6-the-chain-rule'),
  topic('implicit-differentiation', 'Implicit differentiation', 'calculus', /\bimplicit differentiation\b/i, 'calculus-volume-1', '3-8-implicit-differentiation'),
  topic('optimization', 'Optimization', 'calculus', /\boptimi[sz]ation\b/i, 'calculus-volume-1', '4-7-applied-optimization-problems'),
  topic('buffers', 'Buffers', 'chemistry', /\bbuffers?\b/i, 'chemistry-2e', '14-6-buffers'),
  topic('equilibrium', 'Equilibrium constants', 'chemistry', /\bequilibrium constants?\b/i, 'chemistry-2e', '13-2-equilibrium-constants'),
  topic('rate-laws', 'Rate laws', 'chemistry', /\brate laws?\b/i, 'chemistry-2e', '12-3-rate-laws'),
];
export const courseSlug = name => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
