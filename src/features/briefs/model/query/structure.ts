import type {
  BriefDocument,
  Decision,
  DescriptionSection,
  ExhibitsSection,
  Finding,
  FindingsSection,
  BriefExhibit,
  BriefSection,
  PlanSection,
  Question,
  RecordsSection,
  SpecSection,
} from "../schema";

/**
 * The structural index over one document's authored sections, plus the plain
 * structural reads over it. Aggregate queries build the index once and share it
 * with the reads they compose.
 */

export type BriefIndex = {
  sections: BriefSection[];
  specSections: SpecSection[];
  findingSections: FindingsSection[];
  findings: Finding[];
  recordsSections: RecordsSection[];
  recordsSectionsById: Map<string, RecordsSection>;
  planSections: PlanSection[];
  exhibitSections: ExhibitsSection[];
  sectionExhibits: BriefExhibit[];
  optionExhibits: BriefExhibit[];
  questions: Question[];
  questionsById: Map<string, Question>;
  decisions: Decision[];
};

export function buildBriefIndex(sections: readonly BriefSection[]): BriefIndex {
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
    recordsSections,
    recordsSectionsById: new Map(recordsSections.map((section) => [section.id, section])),
    planSections,
    exhibitSections,
    sectionExhibits,
    optionExhibits,
    questions,
    questionsById: new Map(questions.map((question) => [question.id, question])),
    decisions,
  };
}

/** Markdown and list sections guide execution without enumerating requirements. */
export function isDescriptionSection(section: BriefSection): section is DescriptionSection {
  return section.kind === "markdown" || section.kind === "list";
}

export type ResolvedBriefTab = {
  title: string;
  sections: BriefSection[];
};

/** Resolve optional tab references without changing canonical document order. */
export function resolveBriefTabs(document: BriefDocument): ResolvedBriefTab[] {
  if (!document.tabs) {
    return [{ title: document.title, sections: document.sections }];
  }
  return document.tabs.map((tab) => ({
    title: tab.title,
    sections: document.sections.filter((section) => tab.sections.includes(section.id)),
  }));
}

export function findRecordsSection(
  document: BriefDocument,
  sectionId: string,
): RecordsSection | undefined {
  return buildBriefIndex(document.sections).recordsSectionsById.get(sectionId);
}
