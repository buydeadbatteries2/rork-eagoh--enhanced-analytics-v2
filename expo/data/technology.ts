/**
 * Technology Domain — canonical area and role definitions.
 *
 * Used by the Forge wizard when Intelligence Domain = Technology, and for
 * marketplace filtering, leaderboards, and faction team-focus lookups.
 */

export type TechnologyArea = {
  id: string;
  label: string;
};

export type TechnologyRole = {
  id: string;
  label: string;
};

export const TECHNOLOGY_AREAS: TechnologyArea[] = [
  { id: "ai", label: "AI" },
  { id: "software_development", label: "Software Development" },
  { id: "cybersecurity", label: "Cybersecurity" },
  { id: "cloud_computing", label: "Cloud Computing" },
  { id: "mobile_development", label: "Mobile Development" },
  { id: "robotics", label: "Robotics" },
];

export const TECHNOLOGY_ROLES: TechnologyRole[] = [
  { id: "developer", label: "Developer" },
  { id: "engineer", label: "Engineer" },
  { id: "founder", label: "Founder" },
  { id: "reviewer", label: "Reviewer" },
  { id: "researcher", label: "Researcher" },
];

/** Look up a technology area by canonical id. */
export function getTechnologyArea(areaId: string): TechnologyArea | undefined {
  return TECHNOLOGY_AREAS.find((a) => a.id === areaId);
}

/** Look up a technology role by canonical id. */
export function getTechnologyRole(roleId: string): TechnologyRole | undefined {
  return TECHNOLOGY_ROLES.find((r) => r.id === roleId);
}
