/**
 * Health & Fitness Domain — canonical area and role definitions.
 *
 * Used by the Forge wizard when Intelligence Domain = Health & Fitness, and for
 * marketplace filtering, leaderboards, and faction team-focus lookups.
 */

export type HealthFitnessArea = {
  id: string;
  label: string;
};

export type HealthFitnessRole = {
  id: string;
  label: string;
};

export const HEALTH_FITNESS_AREAS: HealthFitnessArea[] = [
  { id: "strength_training", label: "Strength Training" },
  { id: "weight_loss", label: "Weight Loss" },
  { id: "nutrition", label: "Nutrition" },
  { id: "bodybuilding", label: "Bodybuilding" },
  { id: "running", label: "Running" },
  { id: "crossfit", label: "CrossFit" },
];

export const HEALTH_FITNESS_ROLES: HealthFitnessRole[] = [
  { id: "athlete", label: "Athlete" },
  { id: "coach", label: "Coach" },
  { id: "trainer", label: "Trainer" },
  { id: "nutritionist", label: "Nutritionist" },
  { id: "beginner", label: "Beginner" },
];

/** Look up a health & fitness area by canonical id. */
export function getHealthFitnessArea(areaId: string): HealthFitnessArea | undefined {
  return HEALTH_FITNESS_AREAS.find((a) => a.id === areaId);
}

/** Look up a health & fitness role by canonical id. */
export function getHealthFitnessRole(roleId: string): HealthFitnessRole | undefined {
  return HEALTH_FITNESS_ROLES.find((r) => r.id === roleId);
}
