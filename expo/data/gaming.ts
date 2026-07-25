/**
 * Gaming Domain — canonical genre and role definitions.
 *
 * Used by the Forge wizard when Intelligence Domain = Gaming, and for
 * marketplace filtering, leaderboards, and faction team-focus lookups.
 */

export type GamingGenre = {
  id: string;
  label: string;
};

export type GamingRole = {
  id: string;
  label: string;
};

export const GAMING_GENRES: GamingGenre[] = [
  { id: "fps", label: "FPS" },
  { id: "sports", label: "Sports" },
  { id: "rpg", label: "RPG" },
  { id: "mmorpg", label: "MMORPG" },
  { id: "moba", label: "MOBA" },
  { id: "fighting", label: "Fighting" },
  { id: "strategy", label: "Strategy" },
  { id: "simulation", label: "Simulation" },
  { id: "racing", label: "Racing" },
];

export const GAMING_ROLES: GamingRole[] = [
  { id: "player", label: "Player" },
  { id: "coach", label: "Coach" },
  { id: "streamer", label: "Streamer" },
  { id: "analyst", label: "Analyst" },
  { id: "developer", label: "Developer" },
  { id: "content_creator", label: "Content Creator" },
];

/** Look up a gaming genre by canonical id. */
export function getGamingGenre(genreId: string): GamingGenre | undefined {
  return GAMING_GENRES.find((g) => g.id === genreId);
}

/** Look up a gaming role by canonical id. */
export function getGamingRole(roleId: string): GamingRole | undefined {
  return GAMING_ROLES.find((r) => r.id === roleId);
}
