/**
 * Film & Television Domain — canonical category, genre, and role definitions.
 *
 * Used by the Forge wizard when Intelligence Domain = Film & Television, and
 * for marketplace filtering, leaderboards, and faction team-focus lookups.
 */

export type FilmTvCategory = {
  id: string;
  label: string;
};

export type FilmTvGenre = {
  id: string;
  label: string;
};

export type FilmTvRole = {
  id: string;
  label: string;
};

export const FILM_TV_CATEGORIES: FilmTvCategory[] = [
  { id: "movies", label: "Movies" },
  { id: "television", label: "Television" },
  { id: "streaming", label: "Streaming" },
  { id: "animation", label: "Animation" },
  { id: "documentary", label: "Documentary" },
];

export const FILM_TV_GENRES: FilmTvGenre[] = [
  { id: "action", label: "Action" },
  { id: "comedy", label: "Comedy" },
  { id: "drama", label: "Drama" },
  { id: "horror", label: "Horror" },
  { id: "thriller", label: "Thriller" },
  { id: "romance", label: "Romance" },
  { id: "science_fiction", label: "Science Fiction" },
  { id: "fantasy", label: "Fantasy" },
  { id: "crime", label: "Crime" },
  { id: "family", label: "Family" },
];

export const FILM_TV_ROLES: FilmTvRole[] = [
  { id: "actor", label: "Actor" },
  { id: "director", label: "Director" },
  { id: "producer", label: "Producer" },
  { id: "writer", label: "Writer" },
  { id: "critic", label: "Critic" },
  { id: "fan", label: "Fan" },
  { id: "casting_agent", label: "Casting Agent" },
  { id: "cinematographer", label: "Cinematographer" },
];

/** Look up a film/TV category by canonical id. */
export function getFilmTvCategory(categoryId: string): FilmTvCategory | undefined {
  return FILM_TV_CATEGORIES.find((c) => c.id === categoryId);
}

/** Look up a film/TV genre by canonical id. */
export function getFilmTvGenre(genreId: string): FilmTvGenre | undefined {
  return FILM_TV_GENRES.find((g) => g.id === genreId);
}

/** Look up a film/TV role by canonical id. */
export function getFilmTvRole(roleId: string): FilmTvRole | undefined {
  return FILM_TV_ROLES.find((r) => r.id === roleId);
}
