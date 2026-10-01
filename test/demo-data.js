// Customize this file with your school's name, courses, modules and resources.
// IDs must be unique and stable. They connect saved activity to courses and units.
// These are EXAMPLE courses, not a verified catalog for any particular school.
export const school = {
  name: 'Your School',
  storageKey: 'study-commons-demo-v1',
  defaultCourseIds: ['ap-chemistry', 'english-10'],
};

const chemistryTopics = [
  'Atoms & periodic trends', 'Bonding & compound structure', 'Substances & mixtures',
  'Chemical change', 'Reaction rates', 'Heat & chemical energy', 'Chemical equilibrium',
  'Acids, bases & buffers', 'Entropy, free energy & electrochemistry',
];

export const courses = [
  {
    id: 'ap-chemistry', name: 'AP Chemistry', department: 'Science', shortName: 'CH',
    description: 'Notes, practice and discussions organized across nine units.',
    units: chemistryTopics.map((title, index) => ({ id: `unit-${index + 1}`, title: `Unit ${index + 1}: ${title}` })),
    links: [
      { title: 'Official released FRQs & scoring materials', url: 'https://apcentral.collegeboard.org/courses/ap-chemistry/exam/past-exam-questions' },
      { title: 'College Board course framework', url: 'https://apcentral.collegeboard.org/courses/ap-chemistry' },
    ],
    resources: [
      {
        id: 'chem-buffer-notes', unitId: 'unit-8', title: 'Understanding what a buffer does',
        type: 'Notes', source: 'Example course notes',
        text: 'A buffer contains a weak acid and its conjugate base, or a weak base and its conjugate acid. The conjugate base consumes small additions of strong acid; the weak acid consumes small additions of strong base. A buffer resists a change in pH within its capacity. Its pH does not have to be 7.',
      },
    ],
    questions: [
      {
        id: 'chem-question-buffer', unitId: 'unit-8', title: 'How can a buffer contain an acid and still resist pH changes?',
        body: 'I understand that it contains a weak acid and its conjugate base. What happens when a small amount of strong acid is added?',
        author: 'Maya · example', answered: true, mine: false,
        replies: [
          { author: 'Alex · example', body: 'The conjugate base reacts with the added acid. A small addition causes a relatively small change in pH while the buffer has sufficient capacity.' },
          { author: 'Maya · example', body: 'That helps — it is resisting a change in pH, rather than having to be neutral.' },
        ],
      },
      {
        id: 'chem-question-equilibrium', unitId: 'unit-7', title: 'When should we use an ICE table?',
        body: 'How do you decide whether an equilibrium problem needs an ICE table or can be solved directly from the given concentrations?',
        author: 'Jordan · example', answered: false, mine: false, replies: [],
      },
    ],
  },
  {
    id: 'english-10', name: 'English 10', department: 'English', shortName: 'EN',
    description: 'Reading, discussion and writing resources for your class.',
    units: [{ id: 'reading', title: 'Close reading' }, { id: 'argument', title: 'Argument & evidence' }, { id: 'revision', title: 'Writing & revision' }],
    links: [],
    resources: [{ id: 'english-evidence', unitId: 'argument', title: 'Building a paragraph around evidence', type: 'Notes', source: 'Example course notes', text: 'Start with a claim that supports your argument. Introduce relevant evidence and explain how it supports the claim. End by connecting the paragraph to your larger argument. A quotation needs analysis, not just a citation.' }],
    questions: [],
  },
  {
    id: 'algebra-2', name: 'Algebra II', department: 'Mathematics', shortName: 'A2',
    description: 'A sample course ready for your school’s topics and resources.',
    units: [{ id: 'functions', title: 'Functions & graphs' }, { id: 'polynomials', title: 'Polynomial expressions' }, { id: 'exponentials', title: 'Exponents & logarithms' }],
    links: [], resources: [], questions: [],
  },
  {
    id: 'ap-biology', name: 'AP Biology', department: 'Science', shortName: 'BI',
    description: 'Replace this starter outline with your school’s course structure.',
    units: [], links: [], resources: [], questions: [],
  },
];
