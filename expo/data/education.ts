/**
 * Education Domain — canonical subject and role definitions.
 *
 * Used by the Forge wizard when Intelligence Domain = Education, and
 * for marketplace filtering, leaderboards, and faction team-focus lookups.
 */

export type EducationSubject = {
  id: string;
  label: string;
};

export type EducationRole = {
  id: string;
  label: string;
};

export const EDUCATION_SUBJECTS: EducationSubject[] = [
  { id: "mathematics", label: "Mathematics" },
  { id: "science", label: "Science" },
  { id: "history", label: "History" },
  { id: "english", label: "English" },
  { id: "computer_science", label: "Computer Science" },
  { id: "engineering", label: "Engineering" },
  { id: "business", label: "Business" },
  { id: "law", label: "Law" },
  { id: "medicine", label: "Medicine" },
];

export const EDUCATION_ROLES: EducationRole[] = [
  { id: "student", label: "Student" },
  { id: "teacher", label: "Teacher" },
  { id: "tutor", label: "Tutor" },
  { id: "researcher", label: "Researcher" },
  { id: "professor", label: "Professor" },
];

/** Look up an education subject by canonical id. */
export function getEducationSubject(subjectId: string): EducationSubject | undefined {
  return EDUCATION_SUBJECTS.find((s) => s.id === subjectId);
}

/** Look up an education role by canonical id. */
export function getEducationRole(roleId: string): EducationRole | undefined {
  return EDUCATION_ROLES.find((r) => r.id === roleId);
}
