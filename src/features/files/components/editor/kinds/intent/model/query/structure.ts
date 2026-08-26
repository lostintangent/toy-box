import type {
  Decision,
  ExhibitsSection,
  Finding,
  FindingsSection,
  IntentExhibit,
  IntentSection,
  PlanSection,
  Question,
  RecordsSection,
  SpecSection,
} from "../schema";

/**
 * The structural index over one document's authored sections, plus the
 * document locations those sections and items occupy. Aggregate queries build
 * this once and share it with the reads they compose.
 */

export type IntentIndex = {
  sections: IntentSection[];
  specSections: SpecSection[];
  findingSections: FindingsSection[];
  findings: Finding[];
  findingsById: Map<string, Finding>;
  recordsSections: RecordsSection[];
  recordsSectionsById: Map<string, RecordsSection>;
  planSections: PlanSection[];
  exhibitSections: ExhibitsSection[];
  exhibitSectionsById: Map<string, ExhibitsSection>;
  sectionExhibits: IntentExhibit[];
  optionExhibits: IntentExhibit[];
  questions: Question[];
  questionsById: Map<string, Question>;
  decisions: Decision[];
};

export function buildIntentIndex(sections: readonly IntentSection[]): IntentIndex {
  const specSections: SpecSection[] = [];
  const findingSections: FindingsSection[] = [];
  const planSections: PlanSection[] = [];

  for (const section of sections) {
    if (section.kind === "plan") {
      planSections.push(section);
    } else if (section.kind === "findings") {
      findingSections.push(section);
    } else {
      specSections.push(section);
    }
  }

  const recordsSections = specSections.filter(
    (section): section is RecordsSection => section.kind === "records",
  );
  const exhibitSections = specSections.filter(
    (section): section is ExhibitsSection => section.kind === "exhibits",
  );
  const sectionExhibits = exhibitSections.flatMap((section) => section.items);
  const questions = specSections.flatMap((section) =>
    section.kind === "questions" ? section.items : [],
  );
  const decisions = specSections.flatMap((section) =>
    section.kind === "decisions" ? section.items : [],
  );
  const optionExhibits = decisions.flatMap((decision) =>
    decision.options.flatMap((option) => (option.exhibit ? [option.exhibit] : [])),
  );
  const findings = findingSections.flatMap((section) => section.items);

  return {
    sections: [...sections],
    specSections,
    findingSections,
    findings,
    findingsById: new Map(findings.map((finding) => [finding.id, finding])),
    recordsSections,
    recordsSectionsById: new Map(recordsSections.map((section) => [section.id, section])),
    planSections,
    exhibitSections,
    exhibitSectionsById: new Map(exhibitSections.map((section) => [section.id, section])),
    sectionExhibits,
    optionExhibits,
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
  const section = index.specSections.find(
    (candidate) => candidate.kind === "decisions" && candidate.items.includes(item),
  );
  return [...(section ? sectionPathForId(section.id) : ["sections"]), "items", item.id];
}

export function questionPathIn(index: IntentIndex, item: Question): PropertyKey[] {
  const section = index.specSections.find(
    (candidate) => candidate.kind === "questions" && candidate.items.includes(item),
  );
  return [...(section ? sectionPathForId(section.id) : ["sections"]), "items", item.id];
}
