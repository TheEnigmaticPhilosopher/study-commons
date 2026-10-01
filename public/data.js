import { courseNames } from './course-names.js';
import { courseSlug, resourcesFor, subjectFor, topics } from './library.js';
export const school = {
  name: 'Pacifica Christian · Student pilot', storageKey: 'study-commons-school-v2',
  defaultCourseIds: ['ap-calculus-ab', 'ap-chemistry', 'ap-biology'],
};
const chemistryTopics = ['Atomic structure and properties', 'Compound structure and properties', 'Properties of substances and mixtures', 'Chemical reactions', 'Kinetics', 'Thermochemistry', 'Equilibrium', 'Acids and bases', 'Thermodynamics and electrochemistry'];
const chemistryChapters = [[2, 'Atoms, molecules and ions'], [7, 'Chemical bonding and molecular geometry'], [10, 'Liquids and solids'], [4, 'Stoichiometry of chemical reactions'], [12, 'Kinetics'], [5, 'Thermochemistry'], [13, 'Fundamental equilibrium concepts'], [14, 'Acid–base equilibria'], [16, 'Thermodynamics']];
export const courses = courseNames.map(name => {
  const id = courseSlug(name); const subject = subjectFor(name);
  const curated = resourcesFor(name);
  const units = id === 'ap-chemistry' ? chemistryTopics.map((title, index) => ({ id: `unit-${index + 1}`, title: `Unit ${index + 1}: ${title}` }))
    : topics.filter(topic => topic.subject === subject).map(topic => ({ id: topic.id, title: topic.title }));
  units.push({ id: 'reference', title: 'Course reference library' });
  return { id, name, department: subject === 'ushistory' ? 'U.S. History' : subject ? subject[0].toUpperCase() + subject.slice(1) : 'School activities',
    shortName: name.split(/\s+/).filter(word => /^[a-z]/i.test(word)).slice(0, 2).map(word => word[0].toUpperCase()).join(''),
    description: /summer|202[0-9]|semester/i.test(name) ? 'From the Canvas pilot, including historical and summer courses.' : 'School course name from the Canvas pilot. Independently curated public resources.',
    units, links: [], questions: [], resources: [
      ...(id === 'ap-chemistry' ? [...chemistryChapters.map(([chapter, title], index) => ({ id: `chem-chapter-${chapter}`, unitId: `unit-${index + 1}`, title: `${title}: chapter and exercises`, url: `https://openstax.org/books/chemistry-2e/pages/${chapter}-introduction`, type: 'Open reading', source: 'OpenStax Chemistry 2e · free online · see edition license' })), { id: 'chem-chapter-17', unitId: 'unit-9', title: 'Electrochemistry: chapter and exercises', url: 'https://openstax.org/books/chemistry-2e/pages/17-introduction', type: 'Open reading', source: 'OpenStax Chemistry 2e · free online · see edition license' }] : []),
      ...curated.map((item, index) => ({ ...item, source: `${item.source} · ${item.rights}`, id: `${id}-reference-${index}`, unitId: 'reference' })),
      ...topics.filter(topic => topic.subject === subject).map(topic => ({ id: `${id}-${topic.id}`, title: `${topic.title}: lesson and exercises`,
        unitId: id === 'ap-chemistry' ? ({ buffers: 'unit-8', equilibrium: 'unit-7', 'rate-laws': 'unit-5' }[topic.id] || 'reference') : topic.id,
        url: topic.url, type: 'Practice', source: 'OpenStax · free online · see edition license' })),
    ] };
});
