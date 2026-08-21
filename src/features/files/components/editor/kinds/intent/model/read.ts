import type {
  Decision,
  ExhibitsSection,
  IntentExhibit,
  IntentSection,
  LeafSection,
  MapSection,
  Question,
  RecordsSection,
  SequenceSection,
} from "./schema";

/**
 * The flattened read index over one definition's authored sections, plus the
 * document locations those sections and items occupy. Every top-level model
 * operation builds this once and shares it with the projections it composes.
 */

export type IntentIndex = {
  sections: IntentSection[];
  leaves: LeafSection[];
  maps: MapSection[];
  recordsSections: RecordsSection[];
  recordsSectionsById: Map<string, RecordsSection>;
  sequences: SequenceSection[];
  exhibitSections: ExhibitsSection[];
  exhibitSectionsById: Map<string, ExhibitsSection>;
  exhibits: IntentExhibit[];
  questions: Question[];
  questionsById: Map<string, Question>;
  decisions: Decision[];
};

export function buildIntentIndex(sections: readonly IntentSection[]): IntentIndex {
  const allSections: IntentSection[] = [];
  const leaves: LeafSection[] = [];
  const maps: MapSection[] = [];

  for (const section of sections) {
    allSections.push(section);
    if (section.kind === "group") {
      for (const child of section.sections) {
        allSections.push(child);
        leaves.push(child);
      }
    } else if (section.kind === "map") {
      maps.push(section);
    } else {
      leaves.push(section);
    }
  }

  const recordsSections = leaves.filter(
    (section): section is RecordsSection => section.kind === "records",
  );
  const sequences = leaves.filter(
    (section): section is SequenceSection => section.kind === "sequence",
  );
  const exhibitSections = leaves.filter(
    (section): section is ExhibitsSection => section.kind === "exhibits",
  );
  const exhibits = exhibitSections.flatMap((section) => section.items);
  const questions = leaves.flatMap((section) =>
    section.kind === "questions" ? section.items : [],
  );
  const decisions = leaves.flatMap((section) =>
    section.kind === "decisions" ? section.items : [],
  );

  return {
    sections: allSections,
    leaves,
    maps,
    recordsSections,
    recordsSectionsById: new Map(recordsSections.map((section) => [section.id, section])),
    sequences,
    exhibitSections,
    exhibitSectionsById: new Map(exhibitSections.map((section) => [section.id, section])),
    exhibits,
    questions,
    questionsById: new Map(questions.map((question) => [question.id, question])),
    decisions,
  };
}

export function sectionPath(section: IntentSection): PropertyKey[] {
  return sectionPathForId(section.id);
}

export function sectionPathForId(sectionId: string): PropertyKey[] {
  return ["sections", sectionId];
}

export function decisionPathIn(index: IntentIndex, item: Decision): PropertyKey[] {
  const section = index.leaves.find(
    (candidate) => candidate.kind === "decisions" && candidate.items.includes(item),
  );
  return [...(section ? sectionPathForId(section.id) : ["sections"]), "items", item.id];
}

export function questionPathIn(index: IntentIndex, item: Question): PropertyKey[] {
  const section = index.leaves.find(
    (candidate) => candidate.kind === "questions" && candidate.items.includes(item),
  );
  return [...(section ? sectionPathForId(section.id) : ["sections"]), "items", item.id];
}
