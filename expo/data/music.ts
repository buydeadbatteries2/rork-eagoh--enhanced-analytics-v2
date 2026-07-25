/**
 * Music Domain — canonical genre and role definitions.
 *
 * Used by the Forge wizard when Intelligence Domain = Music, and for
 * marketplace filtering, leaderboards, and faction team-focus lookups.
 */

export type MusicGenre = {
  id: string;
  label: string;
};

export type MusicRole = {
  id: string;
  label: string;
};

export const MUSIC_GENRES: MusicGenre[] = [
  { id: "hip_hop", label: "Hip-Hop" },
  { id: "rnb", label: "R&B" },
  { id: "pop", label: "Pop" },
  { id: "rock", label: "Rock" },
  { id: "country", label: "Country" },
  { id: "gospel", label: "Gospel" },
  { id: "jazz", label: "Jazz" },
  { id: "blues", label: "Blues" },
  { id: "classical", label: "Classical" },
  { id: "electronic", label: "Electronic" },
  { id: "reggae", label: "Reggae" },
  { id: "latin", label: "Latin" },
  { id: "metal", label: "Metal" },
  { id: "folk", label: "Folk" },
  { id: "alternative", label: "Alternative" },
];

export const MUSIC_ROLES: MusicRole[] = [
  { id: "artist", label: "Artist" },
  { id: "musician", label: "Musician" },
  { id: "producer", label: "Producer" },
  { id: "songwriter", label: "Songwriter" },
  { id: "engineer", label: "Engineer" },
  { id: "manager", label: "Manager" },
  { id: "agent", label: "Agent" },
  { id: "ar", label: "A&R" },
  { id: "dj", label: "DJ" },
  { id: "fan", label: "Fan" },
  { id: "critic", label: "Critic" },
];

/** Look up a music genre by canonical id. */
export function getMusicGenre(genreId: string): MusicGenre | undefined {
  return MUSIC_GENRES.find((g) => g.id === genreId);
}

/** Look up a music role by canonical id. */
export function getMusicRole(roleId: string): MusicRole | undefined {
  return MUSIC_ROLES.find((r) => r.id === roleId);
}
