/**
 * Arena Subject Suggestions
 *
 * Curated autocomplete suggestions for Arena Mode subject fields.
 * Suggestions respect the selected domain, comparison type, and
 * optional context (sport, genre, league, category, etc.).
 *
 * No external API — all data is bundled locally for offline use.
 */

import type { ArenaComparisonTypeId } from "@/services/arena";

/** A single autocomplete suggestion for an Arena subject field. */
export type ArenaSubjectSuggestion = {
  name: string;
  domain: string;
  comparisonType: string;
  context?: string;
  category?: string;
  league?: string;
  notes?: string;
};

// ── Sports: Teams ──────────────────────────────────────────────────────────

const NFL_TEAMS: ArenaSubjectSuggestion[] = [
  "Atlanta Falcons", "Dallas Cowboys", "Kansas City Chiefs", "Buffalo Bills",
  "Philadelphia Eagles", "San Francisco 49ers", "Baltimore Ravens", "Cincinnati Bengals",
  "Detroit Lions", "Green Bay Packers", "Minnesota Vikings", "Chicago Bears",
  "New York Giants", "Washington Commanders", "New England Patriots", "Miami Dolphins",
  "New York Jets", "Pittsburgh Steelers", "Cleveland Browns", "Houston Texans",
  "Indianapolis Colts", "Tennessee Titans", "Jacksonville Jaguars", "Las Vegas Raiders",
  "Los Angeles Rams", "Seattle Seahawks", "Arizona Cardinals", "Los Angeles Chargers",
  "Denver Broncos", "Carolina Panthers", "New Orleans Saints", "Tampa Bay Buccaneers",
].map((name) => ({
  name,
  domain: "sports",
  comparisonType: "team-vs-team",
  context: "Football",
  league: "NFL",
}));

const NBA_TEAMS: ArenaSubjectSuggestion[] = [
  "Boston Celtics", "Los Angeles Lakers", "Golden State Warriors", "Milwaukee Bucks",
  "Denver Nuggets", "Phoenix Suns", "Dallas Mavericks", "Philadelphia 76ers",
  "Miami Heat", "New York Knicks", "Memphis Grizzlies", "Sacramento Kings",
  "Cleveland Cavaliers", "Chicago Bulls", "Atlanta Hawks", "Brooklyn Nets",
  "Toronto Raptors", "Minnesota Timberwolves", "Oklahoma City Thunder", "New Orleans Pelicans",
  "San Antonio Spurs", "Houston Rockets", "Portland Trail Blazers", "Utah Jazz",
  "Los Angeles Clippers", "Washington Wizards", "Charlotte Hornets", "Detroit Pistons",
  "Orlando Magic", "Indiana Pacers",
].map((name) => ({
  name,
  domain: "sports",
  comparisonType: "team-vs-team",
  context: "Basketball",
  league: "NBA",
}));

const MLB_TEAMS: ArenaSubjectSuggestion[] = [
  "New York Yankees", "Los Angeles Dodgers", "Atlanta Braves", "Houston Astros",
  "Boston Red Sox", "Chicago Cubs", "St. Louis Cardinals", "San Francisco Giants",
  "Philadelphia Phillies", "Toronto Blue Jays", "Texas Rangers", "Tampa Bay Rays",
  "Baltimore Orioles", "Minnesota Twins", "Seattle Mariners", "Cincinnati Reds",
  "Milwaukee Brewers", "Cleveland Guardians", "Arizona Diamondbacks", "San Diego Padres",
  "New York Mets", "Chicago White Sox", "Detroit Tigers", "Kansas City Royals",
  "Pittsburgh Pirates", "Washington Nationals", "Miami Marlins", "Colorado Rockies",
  "Los Angeles Angels", "Oakland Athletics",
].map((name) => ({
  name,
  domain: "sports",
  comparisonType: "team-vs-team",
  context: "Baseball",
  league: "MLB",
}));

const NHL_TEAMS: ArenaSubjectSuggestion[] = [
  "Boston Bruins", "Toronto Maple Leafs", "New York Rangers", "Edmonton Oilers",
  "Colorado Avalanche", "Vegas Golden Knights", "Tampa Bay Lightning", "Florida Panthers",
  "Carolina Hurricanes", "Dallas Stars", "Pittsburgh Penguins", "Washington Capitals",
  "Detroit Red Wings", "Chicago Blackhawks", "Los Angeles Kings", "Philadelphia Flyers",
  "Calgary Flames", "Winnipeg Jets", "Minnesota Wild", "Nashville Predators",
  "Ottawa Senators", "Buffalo Sabres", "New Jersey Devils", "New York Islanders",
  "Montreal Canadiens", "Vancouver Canucks", "Seattle Kraken", "St. Louis Blues",
  "Arizona Coyotes", "San Jose Sharks", "Anaheim Ducks", "Columbus Blue Jackets",
].map((name) => ({
  name,
  domain: "sports",
  comparisonType: "team-vs-team",
  context: "Hockey",
  league: "NHL",
}));

const MLS_TEAMS: ArenaSubjectSuggestion[] = [
  "Inter Miami CF", "LA Galaxy", "Atlanta United", "Seattle Sounders",
  "New York City FC", "Portland Timbers", "Toronto FC", "Philadelphia Union",
  "FC Cincinnati", "Austin FC", "Nashville SC", "FC Dallas",
  "New England Revolution", "Columbus Crew", "Orlando City SC", "Chicago Fire FC",
  "DC United", "Houston Dynamo", "Real Salt Lake", "Minnesota United",
  "Colorado Rapids", "Sporting Kansas City", "San Jose Earthquakes", "Vancouver Whitecaps",
  "Charlotte FC", "St. Louis City SC",
].map((name) => ({
  name,
  domain: "sports",
  comparisonType: "team-vs-team",
  context: "Soccer",
  league: "MLS",
}));

const COLLEGE_FOOTBALL_TEAMS: ArenaSubjectSuggestion[] = [
  "Alabama Crimson Tide", "Georgia Bulldogs", "Ohio State Buckeyes", "Michigan Wolverines",
  "Clemson Tigers", "Oklahoma Sooners", "Texas Longhorns", "LSU Tigers",
  "Oregon Ducks", "Penn State Nittany Lions", "Florida Gators", "Notre Dame Fighting Irish",
  "USC Trojans", "Tennessee Volunteers", "Wisconsin Badgers", "Iowa Hawkeyes",
  "Florida State Seminoles", "Auburn Tigers", "Texas A&M Aggies", "Oklahoma State Cowboys",
  "Michigan State Spartans", "Utah Utes", "Washington Huskies", "TCU Horned Frogs",
  "North Carolina Tar Heels", "Oregon State Beavers", "Missouri Tigers", "Kansas State Wildcats",
  "Ole Miss Rebels", "South Carolina Gamecocks",
].map((name) => ({
  name,
  domain: "sports",
  comparisonType: "team-vs-team",
  context: "Football",
  league: "College Football",
}));

const COLLEGE_BASKETBALL_TEAMS: ArenaSubjectSuggestion[] = [
  "Duke Blue Devils", "North Carolina Tar Heels", "Kansas Jayhawks", "Kentucky Wildcats",
  "Gonzaga Bulldogs", "Villanova Wildcats", "UCLA Bruins", "Connecticut Huskies",
  "Michigan State Spartans", "Indiana Hoosiers", "Louisville Cardinals", "Arizona Wildcats",
  "Tennessee Volunteers", " Baylor Bears", "Houston Cougars", "Texas Longhorns",
  "Florida Gators", "Ohio State Buckeyes", "Syracuse Orange", "Wisconsin Badgers",
  "Iowa State Cyclones", "Purdue Boilermakers", "Alabama Crimson Tide", "Marquette Golden Eagles",
  "Virginia Cavaliers", "Maryland Terrapins", "Arkansas Razorbacks", "Illinois Fighting Illini",
  "Creighton Bluejays", "Saint Mary's Gaels",
].map((name) => ({
  name,
  domain: "sports",
  comparisonType: "team-vs-team",
  context: "Basketball",
  league: "College Basketball",
}));

const ALL_TEAMS: ArenaSubjectSuggestion[] = [
  ...NFL_TEAMS,
  ...NBA_TEAMS,
  ...MLB_TEAMS,
  ...NHL_TEAMS,
  ...MLS_TEAMS,
  ...COLLEGE_FOOTBALL_TEAMS,
  ...COLLEGE_BASKETBALL_TEAMS,
];

// ── Sports: Players ────────────────────────────────────────────────────────

const BASKETBALL_PLAYERS: ArenaSubjectSuggestion[] = [
  "LeBron James", "Michael Jordan", "Kobe Bryant", "Kareem Abdul-Jabbar",
  "Magic Johnson", "Larry Bird", "Bill Russell", "Wilt Chamberlain",
  "Shaquille O'Neal", "Tim Duncan", "Stephen Curry", "Kevin Durant",
  "Giannis Antetokounmpo", "Nikola Jokic", "Luka Doncic", "Joel Embiid",
  "Jayson Tatum", "Damian Lillard", "Chris Paul", "Russell Westbrook",
  "James Harden", "Anthony Davis", "Kawhi Leonard", "Paul George",
  "Devin Booker", "Trae Young", "Ja Morant", "Zion Williamson",
  "Shai Gilgeous-Alexander", "Anthony Edwards",
].map((name) => ({
  name,
  domain: "sports",
  comparisonType: "player-vs-player",
  context: "Basketball",
  league: "NBA",
}));

const FOOTBALL_PLAYERS: ArenaSubjectSuggestion[] = [
  "Tom Brady", "Patrick Mahomes", "Peyton Manning", "Joe Montana",
  "Aaron Rodgers", "Drew Brees", "Brett Favre", "Dan Marino",
  "Jerry Rice", "Randy Moss", "Terrell Owens", "Calvin Johnson",
  "Lawrence Taylor", "Reggie White", "Ray Lewis", "Brian Urlacher",
  "Barry Sanders", "Emmitt Smith", "Walter Payton", "Adrian Peterson",
  "Jim Brown", "LaDainian Tomlinson", "Marshawn Lynch", "Christian McCaffrey",
  "Travis Kelce", "Rob Gronkowski", "J.J. Watt", "Aaron Donald",
  "Tyreek Hill", "Lamar Jackson",
].map((name) => ({
  name,
  domain: "sports",
  comparisonType: "player-vs-player",
  context: "Football",
  league: "NFL",
}));

const BASEBALL_PLAYERS: ArenaSubjectSuggestion[] = [
  "Babe Ruth", "Willie Mays", "Hank Aaron", "Ted Williams",
  "Barry Bonds", "Derek Jeter", "Mike Trout", "Shohei Ohtani",
  "Mickey Mantle", "Nolan Ryan", "Greg Maddux", "Randy Johnson",
  "Pedro Martinez", "Clayton Kershaw", "Mariano Rivera", "Ichiro Suzuki",
  "Albert Pujols", "Miguel Cabrera", "Ken Griffey Jr.", "Tony Gwynn",
  "Roberto Clemente", "Cal Ripken Jr.", "Reggie Jackson", "Sandy Koufax",
  "Cy Young", "Tom Seaver", "Joe DiMaggio", "Lou Gehrig",
  "Ronald Acuna Jr.", "Juan Soto",
].map((name) => ({
  name,
  domain: "sports",
  comparisonType: "player-vs-player",
  context: "Baseball",
  league: "MLB",
}));

const HOCKEY_PLAYERS: ArenaSubjectSuggestion[] = [
  "Wayne Gretzky", "Mario Lemieux", "Bobby Orr", "Gordie Howe",
  "Sidney Crosby", "Alex Ovechkin", "Connor McDavid", "Patrick Roy",
  "Martin Brodeur", "Dominik Hasek", "Niklas Lidstrom", "Ray Bourque",
  "Steve Yzerman", "Mark Messier", "Phil Esposito", "Maurice Richard",
  "Guy Lafleur", "Brett Hull", "Mike Modano", "Jaromir Jagr",
  "Patrick Kane", "Auston Matthews", "Nathan MacKinnon", "Leon Draisaitl",
  "Erik Karlsson", "Victor Hedman", "Carey Price", "Jonathan Toews",
  "Anze Kopitar", "John Tavares",
].map((name) => ({
  name,
  domain: "sports",
  comparisonType: "player-vs-player",
  context: "Hockey",
  league: "NHL",
}));

const SOCCER_PLAYERS: ArenaSubjectSuggestion[] = [
  "Lionel Messi", "Cristiano Ronaldo", "Pele", "Diego Maradona",
  "Johan Cruyff", "Zinedine Zidane", "Ronaldinho", "Ronaldo Nazario",
  "Neymar", "Kylian Mbappe", "Erling Haaland", "Vinicius Junior",
  "Luka Modric", "Kevin De Bruyne", "Mohamed Salah", "Sadio Mane",
  "Robert Lewandowski", "Harry Kane", "Karim Benzema", "Luis Suarez",
  "Andres Iniesta", "Xavi", "Frank Lampard", "Steven Gerrard",
  "David Beckham", "Thierry Henry", "Gianluigi Buffon", "Iker Casillas",
  "Manuel Neuer", "Alisson Becker",
].map((name) => ({
  name,
  domain: "sports",
  comparisonType: "player-vs-player",
  context: "Soccer",
  league: "Various",
}));

const ALL_PLAYERS: ArenaSubjectSuggestion[] = [
  ...BASKETBALL_PLAYERS,
  ...FOOTBALL_PLAYERS,
  ...BASEBALL_PLAYERS,
  ...HOCKEY_PLAYERS,
  ...SOCCER_PLAYERS,
];

// ── Sports: Coaches ────────────────────────────────────────────────────────

const BASKETBALL_COACHES: ArenaSubjectSuggestion[] = [
  "Phil Jackson", "Gregg Popovich", "Pat Riley", "John Wooden",
  "Mike Krzyzewski", "Dean Smith", "Bobby Knight", "Rick Pitino",
  "Red Auerbach", "Chuck Daly", "Larry Brown", "Don Nelson",
  "Doc Rivers", "Steve Kerr", "Erik Spoelstra", "Tyronn Lue",
  "Brad Stevens", "Nick Nurse", "Monty Williams", "Billy Donovan",
].map((name) => ({
  name,
  domain: "sports",
  comparisonType: "coach-vs-coach",
  context: "Basketball",
  league: "NBA/College",
}));

const FOOTBALL_COACHES: ArenaSubjectSuggestion[] = [
  "Bill Belichick", "Vince Lombardi", "Chuck Noll", "Don Shula",
  "Tom Landry", "Bill Walsh", "Joe Gibbs", "Bill Parcells",
  "Nick Saban", "Bear Bryant", "Knute Rockne", "Woody Hayes",
  "Joe Paterno", "Bobby Bowden", "Urban Meyer", "Dabo Swinney",
  "Pete Carroll", "Andy Reid", "Sean McVay", "Mike Tomlin",
].map((name) => ({
  name,
  domain: "sports",
  comparisonType: "coach-vs-coach",
  context: "Football",
  league: "NFL/College",
}));

const BASEBALL_COACHES: ArenaSubjectSuggestion[] = [
  "Joe Torre", "Tony La Russa", "Bobby Cox", "Sparky Anderson",
  "Casey Stengel", "John McGraw", "Connie Mack", "Walter Alston",
  "Tommy Lasorda", "Bruce Bochy", "Terry Francona", "Joe Maddon",
  "Dusty Baker", "Bruce Bochy", "Dave Roberts", "Brian Snitker",
].map((name) => ({
  name,
  domain: "sports",
  comparisonType: "coach-vs-coach",
  context: "Baseball",
  league: "MLB",
}));

const HOCKEY_COACHES: ArenaSubjectSuggestion[] = [
  "Scotty Bowman", "Al Arbour", "Glen Sather", "Joel Quenneville",
  "Mike Babcock", "Ken Hitchcock", "Barry Trotz", "Peter Laviolette",
  "Jon Cooper", "Bruce Cassidy", "Rod Brind'Amour", "Jared Bednar",
].map((name) => ({
  name,
  domain: "sports",
  comparisonType: "coach-vs-coach",
  context: "Hockey",
  league: "NHL",
}));

const SOCCER_COACHES: ArenaSubjectSuggestion[] = [
  "Pep Guardiola", "Jurgen Klopp", "Jose Mourinho", "Carlo Ancelotti",
  "Arsene Wenger", "Sir Alex Ferguson", "Diego Simeone", "Antonio Conte",
  "Massimiliano Allegri", "Thomas Tuchel", "Hansi Flick", "Roberto Mancini",
  "Luis Enrique", "Mauricio Pochettino", "Rafa Benitez", "Unai Emery",
].map((name) => ({
  name,
  domain: "sports",
  comparisonType: "coach-vs-coach",
  context: "Soccer",
  league: "Various",
}));

const ALL_COACHES: ArenaSubjectSuggestion[] = [
  ...BASKETBALL_COACHES,
  ...FOOTBALL_COACHES,
  ...BASEBALL_COACHES,
  ...HOCKEY_COACHES,
  ...SOCCER_COACHES,
];

// ── Sports: Season suggestions (reuses player/team names) ──────────────────

const SEASON_EXAMPLES: ArenaSubjectSuggestion[] = [
  ...ALL_PLAYERS.slice(0, 20).map((p) => ({
    ...p,
    comparisonType: "season-vs-season" as const,
    notes: "Use year field for the specific season",
  })),
  ...ALL_TEAMS.slice(0, 20).map((t) => ({
    ...t,
    comparisonType: "season-vs-season" as const,
    notes: "Use year field for the specific season",
  })),
];

// ── All suggestions master list ────────────────────────────────────────────

const ALL_SUGGESTIONS: ArenaSubjectSuggestion[] = [
  ...ALL_TEAMS,
  ...ALL_PLAYERS,
  ...ALL_COACHES,
  ...SEASON_EXAMPLES,
];

// ── Suggestion filter helper ───────────────────────────────────────────────

/** Normalize a string for case-insensitive, accent-insensitive matching. */
function normalizeForMatch(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Get filtered autocomplete suggestions for the Arena subject field.
 *
 * @param query — what the user has typed so far
 * @param domain — the selected EAGOH domain (e.g. "sports")
 * @param comparisonType — the selected comparison type (e.g. "team-vs-team")
 * @param context — optional context like "Football", "Basketball" to prioritize
 * @param limit — max number of suggestions to return (default 8)
 * @returns suggestions matching the criteria, prioritized by context match
 */
export function getArenaSuggestions(
  query: string,
  domain: string,
  comparisonType: ArenaComparisonTypeId,
  context?: string,
  limit: number = 8,
): ArenaSubjectSuggestion[] {
  const q = normalizeForMatch(query);
  if (q.length < 1) return [];

  // Filter by domain + comparison type first
  let candidates = ALL_SUGGESTIONS.filter(
    (s) =>
      s.domain === domain &&
      s.comparisonType === comparisonType,
  );

  // If no candidates for this domain/comparisonType combo, return empty
  // (the user can still type manually)
  if (candidates.length === 0) return [];

  // Filter by query match on name
  const matches = candidates.filter((s) =>
    normalizeForMatch(s.name).includes(q),
  );

  // Prioritize: if context is provided, boost suggestions whose context matches
  const contextNorm = context ? normalizeForMatch(context) : "";
  if (contextNorm) {
    const contextMatches = matches.filter(
      (s) => s.context && normalizeForMatch(s.context) === contextNorm,
    );
    const other = matches.filter(
      (s) => !s.context || normalizeForMatch(s.context) !== contextNorm,
    );
    return [...contextMatches, ...other].slice(0, limit);
  }

  return matches.slice(0, limit);
}
