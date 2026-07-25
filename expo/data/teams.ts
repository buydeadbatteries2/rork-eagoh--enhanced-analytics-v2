/**
 * Canonical team and college data for Sports-domain EAGOHs.
 *
 * Each team has a unique canonical ID (e.g. "nfl_dallas_cowboys") that is
 * used for filtering, Marketplace, Factions, and Leaderboards. Display names
 * are kept for UI rendering. No logos, league marks, or official artwork.
 *
 * Color families are provided as inspired palette hints only.
 */

export interface TeamData {
  id: string;
  display_name: string;
  aliases: string[];
  sport: string;
  league: string;
  level: "Pro" | "College";
  city: string;
  state: string;
  country: string;
  color_family: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────

const T = (
  id: string,
  display_name: string,
  aliases: string[],
  sport: string,
  league: string,
  level: "Pro" | "College",
  city: string,
  state: string,
  country: string,
  color_family: string[],
): TeamData => ({ id, display_name, aliases, sport, league, level, city, state, country, color_family });

// ── NFL (32 teams) ───────────────────────────────────────────────────

const NFL: TeamData[] = [
  T("nfl_arizona_cardinals", "Arizona Cardinals", ["Cardinals", "Arizona", "AZ Cards", "Redbirds"], "Football", "NFL", "Pro", "Glendale", "Arizona", "USA", ["cardinal_red", "white", "black"]),
  T("nfl_atlanta_falcons", "Atlanta Falcons", ["Falcons", "Atlanta", "ATL", "Dirty Birds"], "Football", "NFL", "Pro", "Atlanta", "Georgia", "USA", ["red", "black", "silver"]),
  T("nfl_baltimore_ravens", "Baltimore Ravens", ["Ravens", "Baltimore", "BAL", "Purple Birds"], "Football", "NFL", "Pro", "Baltimore", "Maryland", "USA", ["purple", "black", "gold"]),
  T("nfl_buffalo_bills", "Buffalo Bills", ["Bills", "Buffalo", "BUF", "Bills Mafia"], "Football", "NFL", "Pro", "Orchard Park", "New York", "USA", ["royal_blue", "red", "white"]),
  T("nfl_carolina_panthers", "Carolina Panthers", ["Panthers", "Carolina", "CAR"], "Football", "NFL", "Pro", "Charlotte", "North Carolina", "USA", ["black", "panther_blue", "silver"]),
  T("nfl_chicago_bears", "Chicago Bears", ["Bears", "Chicago", "CHI", "Da Bears", "Monsters of the Midway"], "Football", "NFL", "Pro", "Chicago", "Illinois", "USA", ["navy", "orange", "white"]),
  T("nfl_cincinnati_bengals", "Cincinnati Bengals", ["Bengals", "Cincinnati", "CIN", "Who Dey"], "Football", "NFL", "Pro", "Cincinnati", "Ohio", "USA", ["orange", "black", "white"]),
  T("nfl_cleveland_browns", "Cleveland Browns", ["Browns", "Cleveland", "CLE", "Dawg Pound"], "Football", "NFL", "Pro", "Cleveland", "Ohio", "USA", ["brown", "orange", "white"]),
  T("nfl_dallas_cowboys", "Dallas Cowboys", ["Cowboys", "Dallas", "DAL", "America's Team"], "Football", "NFL", "Pro", "Arlington", "Texas", "USA", ["navy", "silver", "white"]),
  T("nfl_denver_broncos", "Denver Broncos", ["Broncos", "Denver", "DEN", "Orange Crush"], "Football", "NFL", "Pro", "Denver", "Colorado", "USA", ["orange", "navy", "white"]),
  T("nfl_detroit_lions", "Detroit Lions", ["Lions", "Detroit", "DET", "Motor City"], "Football", "NFL", "Pro", "Detroit", "Michigan", "USA", ["honolulu_blue", "silver", "black"]),
  T("nfl_green_bay_packers", "Green Bay Packers", ["Packers", "Green Bay", "GB", "Pack", "Cheeseheads"], "Football", "NFL", "Pro", "Green Bay", "Wisconsin", "USA", ["green", "gold", "white"]),
  T("nfl_houston_texans", "Houston Texans", ["Texans", "Houston", "HOU"], "Football", "NFL", "Pro", "Houston", "Texas", "USA", ["deep_steel_blue", "battle_red", "white"]),
  T("nfl_indianapolis_colts", "Indianapolis Colts", ["Colts", "Indianapolis", "IND"], "Football", "NFL", "Pro", "Indianapolis", "Indiana", "USA", ["royal_blue", "white"]),
  T("nfl_jacksonville_jaguars", "Jacksonville Jaguars", ["Jaguars", "Jacksonville", "JAX", "Jags"], "Football", "NFL", "Pro", "Jacksonville", "Florida", "USA", ["teal", "black", "gold"]),
  T("nfl_kansas_city_chiefs", "Kansas City Chiefs", ["Chiefs", "Kansas City", "KC", "Kingdom"], "Football", "NFL", "Pro", "Kansas City", "Missouri", "USA", ["red", "gold", "white"]),
  T("nfl_las_vegas_raiders", "Las Vegas Raiders", ["Raiders", "Las Vegas", "LV", "Silver and Black"], "Football", "NFL", "Pro", "Paradise", "Nevada", "USA", ["silver", "black"]),
  T("nfl_los_angeles_chargers", "Los Angeles Chargers", ["Chargers", "LA Chargers", "LAC", "Bolt Up"], "Football", "NFL", "Pro", "Inglewood", "California", "USA", ["powder_blue", "gold", "white"]),
  T("nfl_los_angeles_rams", "Los Angeles Rams", ["Rams", "LA Rams", "LAR"], "Football", "NFL", "Pro", "Inglewood", "California", "USA", ["royal_blue", "sol", "white"]),
  T("nfl_miami_dolphins", "Miami Dolphins", ["Dolphins", "Miami", "MIA", "Fins"], "Football", "NFL", "Pro", "Miami Gardens", "Florida", "USA", ["aqua", "orange", "white"]),
  T("nfl_minnesota_vikings", "Minnesota Vikings", ["Vikings", "Minnesota", "MIN", "Vikes", "Skol"], "Football", "NFL", "Pro", "Minneapolis", "Minnesota", "USA", ["purple", "gold", "white"]),
  T("nfl_new_england_patriots", "New England Patriots", ["Patriots", "New England", "NE", "Pats"], "Football", "NFL", "Pro", "Foxborough", "Massachusetts", "USA", ["navy", "red", "silver"]),
  T("nfl_new_orleans_saints", "New Orleans Saints", ["Saints", "New Orleans", "NO", "Who Dat"], "Football", "NFL", "Pro", "New Orleans", "Louisiana", "USA", ["black", "old_gold", "white"]),
  T("nfl_new_york_giants", "New York Giants", ["Giants", "NY Giants", "NYG", "Big Blue", "G-Men"], "Football", "NFL", "Pro", "East Rutherford", "New Jersey", "USA", ["blue", "red", "white"]),
  T("nfl_new_york_jets", "New York Jets", ["Jets", "NY Jets", "NYJ", "Gang Green"], "Football", "NFL", "Pro", "East Rutherford", "New Jersey", "USA", ["green", "white"]),
  T("nfl_philadelphia_eagles", "Philadelphia Eagles", ["Eagles", "Philadelphia", "PHI", "Birds"], "Football", "NFL", "Pro", "Philadelphia", "Pennsylvania", "USA", ["midnight_green", "black", "silver"]),
  T("nfl_pittsburgh_steelers", "Pittsburgh Steelers", ["Steelers", "Pittsburgh", "PIT", "Steel City"], "Football", "NFL", "Pro", "Pittsburgh", "Pennsylvania", "USA", ["black", "gold", "white"]),
  T("nfl_san_francisco_49ers", "San Francisco 49ers", ["49ers", "San Francisco", "SF", "Niners", "Gold Rush"], "Football", "NFL", "Pro", "Santa Clara", "California", "USA", ["red", "gold", "white"]),
  T("nfl_seattle_seahawks", "Seattle Seahawks", ["Seahawks", "Seattle", "SEA", "Hawks", "12s"], "Football", "NFL", "Pro", "Seattle", "Washington", "USA", ["college_navy", "action_green", "wolf_grey"]),
  T("nfl_tampa_bay_buccaneers", "Tampa Bay Buccaneers", ["Buccaneers", "Tampa Bay", "TB", "Bucs"], "Football", "NFL", "Pro", "Tampa", "Florida", "USA", ["red", "pewter", "black"]),
  T("nfl_tennessee_titans", "Tennessee Titans", ["Titans", "Tennessee", "TEN"], "Football", "NFL", "Pro", "Nashville", "Tennessee", "USA", ["titans_blue", "navy", "red"]),
  T("nfl_washington_commanders", "Washington Commanders", ["Commanders", "Washington", "WAS", "DC"], "Football", "NFL", "Pro", "Landover", "Maryland", "USA", ["burgundy", "gold", "white"]),
];

// ── NBA (30 teams) ───────────────────────────────────────────────────

const NBA: TeamData[] = [
  T("nba_atlanta_hawks", "Atlanta Hawks", ["Hawks", "Atlanta", "ATL"], "Basketball", "NBA", "Pro", "Atlanta", "Georgia", "USA", ["red", "volt_green", "white"]),
  T("nba_boston_celtics", "Boston Celtics", ["Celtics", "Boston", "BOS", "C's"], "Basketball", "NBA", "Pro", "Boston", "Massachusetts", "USA", ["green", "white", "gold"]),
  T("nba_brooklyn_nets", "Brooklyn Nets", ["Nets", "Brooklyn", "BKN"], "Basketball", "NBA", "Pro", "Brooklyn", "New York", "USA", ["black", "white"]),
  T("nba_charlotte_hornets", "Charlotte Hornets", ["Hornets", "Charlotte", "CHA", "Buzz City"], "Basketball", "NBA", "Pro", "Charlotte", "North Carolina", "USA", ["teal", "purple", "white"]),
  T("nba_chicago_bulls", "Chicago Bulls", ["Bulls", "Chicago", "CHI"], "Basketball", "NBA", "Pro", "Chicago", "Illinois", "USA", ["red", "black", "white"]),
  T("nba_cleveland_cavaliers", "Cleveland Cavaliers", ["Cavaliers", "Cleveland", "CLE", "Cavs"], "Basketball", "NBA", "Pro", "Cleveland", "Ohio", "USA", ["wine", "gold", "navy"]),
  T("nba_dallas_mavericks", "Dallas Mavericks", ["Mavericks", "Dallas", "DAL", "Mavs"], "Basketball", "NBA", "Pro", "Dallas", "Texas", "USA", ["royal_blue", "silver", "black"]),
  T("nba_denver_nuggets", "Denver Nuggets", ["Nuggets", "Denver", "DEN", "Nugs"], "Basketball", "NBA", "Pro", "Denver", "Colorado", "USA", ["navy", "gold", "skyline_blue"]),
  T("nba_detroit_pistons", "Detroit Pistons", ["Pistons", "Detroit", "DET", "Motor City"], "Basketball", "NBA", "Pro", "Detroit", "Michigan", "USA", ["red", "royal_blue", "white"]),
  T("nba_golden_state_warriors", "Golden State Warriors", ["Warriors", "Golden State", "GS", "Dubs", "GSW"], "Basketball", "NBA", "Pro", "San Francisco", "California", "USA", ["royal_blue", "gold", "white"]),
  T("nba_houston_rockets", "Houston Rockets", ["Rockets", "Houston", "HOU"], "Basketball", "NBA", "Pro", "Houston", "Texas", "USA", ["red", "silver", "white"]),
  T("nba_indiana_pacers", "Indiana Pacers", ["Pacers", "Indiana", "IND"], "Basketball", "NBA", "Pro", "Indianapolis", "Indiana", "USA", ["navy", "gold", "white"]),
  T("nba_los_angeles_clippers", "LA Clippers", ["Clippers", "LA Clippers", "LAC", "Clips"], "Basketball", "NBA", "Pro", "Inglewood", "California", "USA", ["navy", "red", "pacific_blue"]),
  T("nba_los_angeles_lakers", "LA Lakers", ["Lakers", "LA Lakers", "LAL", "Showtime"], "Basketball", "NBA", "Pro", "Los Angeles", "California", "USA", ["purple", "gold", "white"]),
  T("nba_memphis_grizzlies", "Memphis Grizzlies", ["Grizzlies", "Memphis", "MEM", "Grizz"], "Basketball", "NBA", "Pro", "Memphis", "Tennessee", "USA", ["navy", "blue", "gold"]),
  T("nba_miami_heat", "Miami Heat", ["Heat", "Miami", "MIA"], "Basketball", "NBA", "Pro", "Miami", "Florida", "USA", ["red", "yellow", "black"]),
  T("nba_milwaukee_bucks", "Milwaukee Bucks", ["Bucks", "Milwaukee", "MIL", "Fear the Deer"], "Basketball", "NBA", "Pro", "Milwaukee", "Wisconsin", "USA", ["green", "cream", "blue"]),
  T("nba_minnesota_timberwolves", "Minnesota Timberwolves", ["Timberwolves", "Minnesota", "MIN", "Wolves"], "Basketball", "NBA", "Pro", "Minneapolis", "Minnesota", "USA", ["blue", "green", "white"]),
  T("nba_new_orleans_pelicans", "New Orleans Pelicans", ["Pelicans", "New Orleans", "NO", "Pels"], "Basketball", "NBA", "Pro", "New Orleans", "Louisiana", "USA", ["navy", "gold", "red"]),
  T("nba_new_york_knicks", "New York Knicks", ["Knicks", "New York", "NY", "NYK", "Knickerbockers"], "Basketball", "NBA", "Pro", "New York City", "New York", "USA", ["blue", "orange", "silver"]),
  T("nba_oklahoma_city_thunder", "Oklahoma City Thunder", ["Thunder", "Oklahoma City", "OKC"], "Basketball", "NBA", "Pro", "Oklahoma City", "Oklahoma", "USA", ["blue", "orange", "yellow"]),
  T("nba_orlando_magic", "Orlando Magic", ["Magic", "Orlando", "ORL"], "Basketball", "NBA", "Pro", "Orlando", "Florida", "USA", ["blue", "black", "silver"]),
  T("nba_philadelphia_76ers", "Philadelphia 76ers", ["76ers", "Philadelphia", "PHI", "Sixers"], "Basketball", "NBA", "Pro", "Philadelphia", "Pennsylvania", "USA", ["blue", "red", "white"]),
  T("nba_phoenix_suns", "Phoenix Suns", ["Suns", "Phoenix", "PHX"], "Basketball", "NBA", "Pro", "Phoenix", "Arizona", "USA", ["purple", "orange", "black"]),
  T("nba_portland_trail_blazers", "Portland Trail Blazers", ["Trail Blazers", "Portland", "POR", "Blazers", "Rip City"], "Basketball", "NBA", "Pro", "Portland", "Oregon", "USA", ["red", "black", "white"]),
  T("nba_sacramento_kings", "Sacramento Kings", ["Kings", "Sacramento", "SAC"], "Basketball", "NBA", "Pro", "Sacramento", "California", "USA", ["purple", "black", "silver"]),
  T("nba_san_antonio_spurs", "San Antonio Spurs", ["Spurs", "San Antonio", "SA"], "Basketball", "NBA", "Pro", "San Antonio", "Texas", "USA", ["silver", "black", "white"]),
  T("nba_toronto_raptors", "Toronto Raptors", ["Raptors", "Toronto", "TOR", "Raps", "We The North"], "Basketball", "NBA", "Pro", "Toronto", "Ontario", "Canada", ["red", "black", "white"]),
  T("nba_utah_jazz", "Utah Jazz", ["Jazz", "Utah", "UTA"], "Basketball", "NBA", "Pro", "Salt Lake City", "Utah", "USA", ["purple", "gold", "black"]),
  T("nba_washington_wizards", "Washington Wizards", ["Wizards", "Washington", "WAS", "DC"], "Basketball", "NBA", "Pro", "Washington", "District of Columbia", "USA", ["navy", "red", "silver"]),
];

// ── MLB (30 teams) ───────────────────────────────────────────────────

const MLB: TeamData[] = [
  T("mlb_arizona_diamondbacks", "Arizona Diamondbacks", ["Diamondbacks", "Arizona", "AZ", "D-backs"], "Baseball", "MLB", "Pro", "Phoenix", "Arizona", "USA", ["sedona_red", "black", "teal"]),
  T("mlb_atlanta_braves", "Atlanta Braves", ["Braves", "Atlanta", "ATL"], "Baseball", "MLB", "Pro", "Atlanta", "Georgia", "USA", ["navy", "red", "white"]),
  T("mlb_baltimore_orioles", "Baltimore Orioles", ["Orioles", "Baltimore", "BAL", "O's"], "Baseball", "MLB", "Pro", "Baltimore", "Maryland", "USA", ["orange", "black", "white"]),
  T("mlb_boston_red_sox", "Boston Red Sox", ["Red Sox", "Boston", "BOS", "Sox"], "Baseball", "MLB", "Pro", "Boston", "Massachusetts", "USA", ["red", "navy", "white"]),
  T("mlb_chicago_cubs", "Chicago Cubs", ["Cubs", "Chicago", "CHC", "Cubbies"], "Baseball", "MLB", "Pro", "Chicago", "Illinois", "USA", ["blue", "red", "white"]),
  T("mlb_chicago_white_sox", "Chicago White Sox", ["White Sox", "Chicago", "CHW", "South Siders"], "Baseball", "MLB", "Pro", "Chicago", "Illinois", "USA", ["black", "silver", "white"]),
  T("mlb_cincinnati_reds", "Cincinnati Reds", ["Reds", "Cincinnati", "CIN"], "Baseball", "MLB", "Pro", "Cincinnati", "Ohio", "USA", ["red", "white", "black"]),
  T("mlb_cleveland_guardians", "Cleveland Guardians", ["Guardians", "Cleveland", "CLE"], "Baseball", "MLB", "Pro", "Cleveland", "Ohio", "USA", ["navy", "red", "white"]),
  T("mlb_colorado_rockies", "Colorado Rockies", ["Rockies", "Colorado", "COL", "Rox"], "Baseball", "MLB", "Pro", "Denver", "Colorado", "USA", ["purple", "black", "silver"]),
  T("mlb_detroit_tigers", "Detroit Tigers", ["Tigers", "Detroit", "DET"], "Baseball", "MLB", "Pro", "Detroit", "Michigan", "USA", ["navy", "orange", "white"]),
  T("mlb_houston_astros", "Houston Astros", ["Astros", "Houston", "HOU", "Stros"], "Baseball", "MLB", "Pro", "Houston", "Texas", "USA", ["orange", "navy", "white"]),
  T("mlb_kansas_city_royals", "Kansas City Royals", ["Royals", "Kansas City", "KC"], "Baseball", "MLB", "Pro", "Kansas City", "Missouri", "USA", ["royal_blue", "gold", "white"]),
  T("mlb_los_angeles_angels", "Los Angeles Angels", ["Angels", "LA Angels", "LAA", "Halos"], "Baseball", "MLB", "Pro", "Anaheim", "California", "USA", ["red", "navy", "white"]),
  T("mlb_los_angeles_dodgers", "Los Angeles Dodgers", ["Dodgers", "LA Dodgers", "LAD", "Boys in Blue"], "Baseball", "MLB", "Pro", "Los Angeles", "California", "USA", ["dodger_blue", "white", "red"]),
  T("mlb_miami_marlins", "Miami Marlins", ["Marlins", "Miami", "MIA", "Fish"], "Baseball", "MLB", "Pro", "Miami", "Florida", "USA", ["miami_blue", "red", "black"]),
  T("mlb_milwaukee_brewers", "Milwaukee Brewers", ["Brewers", "Milwaukee", "MIL", "Brew Crew"], "Baseball", "MLB", "Pro", "Milwaukee", "Wisconsin", "USA", ["navy", "gold", "white"]),
  T("mlb_minnesota_twins", "Minnesota Twins", ["Twins", "Minnesota", "MIN"], "Baseball", "MLB", "Pro", "Minneapolis", "Minnesota", "USA", ["navy", "red", "white"]),
  T("mlb_new_york_mets", "New York Mets", ["Mets", "New York", "NYM", "Amazins"], "Baseball", "MLB", "Pro", "Queens", "New York", "USA", ["blue", "orange", "white"]),
  T("mlb_new_york_yankees", "New York Yankees", ["Yankees", "New York", "NYY", "Yanks", "Bronx Bombers"], "Baseball", "MLB", "Pro", "Bronx", "New York", "USA", ["navy", "white", "gray"]),
  T("mlb_oakland_athletics", "Athletics", ["Athletics", "Oakland", "OAK", "A's"], "Baseball", "MLB", "Pro", "Oakland", "California", "USA", ["green", "gold", "white"]),
  T("mlb_philadelphia_phillies", "Philadelphia Phillies", ["Phillies", "Philadelphia", "PHI", "Phils", "Fightins"], "Baseball", "MLB", "Pro", "Philadelphia", "Pennsylvania", "USA", ["red", "white", "blue"]),
  T("mlb_pittsburgh_pirates", "Pittsburgh Pirates", ["Pirates", "Pittsburgh", "PIT", "Bucs"], "Baseball", "MLB", "Pro", "Pittsburgh", "Pennsylvania", "USA", ["black", "gold", "white"]),
  T("mlb_san_diego_padres", "San Diego Padres", ["Padres", "San Diego", "SD", "Friars"], "Baseball", "MLB", "Pro", "San Diego", "California", "USA", ["brown", "gold", "white"]),
  T("mlb_san_francisco_giants", "San Francisco Giants", ["Giants", "San Francisco", "SF"], "Baseball", "MLB", "Pro", "San Francisco", "California", "USA", ["orange", "black", "cream"]),
  T("mlb_seattle_mariners", "Seattle Mariners", ["Mariners", "Seattle", "SEA", "Ms"], "Baseball", "MLB", "Pro", "Seattle", "Washington", "USA", ["navy", "teal", "silver"]),
  T("mlb_st_louis_cardinals", "St. Louis Cardinals", ["Cardinals", "St. Louis", "STL", "Cards", "Redbirds"], "Baseball", "MLB", "Pro", "St. Louis", "Missouri", "USA", ["red", "white", "navy"]),
  T("mlb_tampa_bay_rays", "Tampa Bay Rays", ["Rays", "Tampa Bay", "TB"], "Baseball", "MLB", "Pro", "St. Petersburg", "Florida", "USA", ["navy", "columbia_blue", "yellow"]),
  T("mlb_texas_rangers", "Texas Rangers", ["Rangers", "Texas", "TEX"], "Baseball", "MLB", "Pro", "Arlington", "Texas", "USA", ["blue", "red", "white"]),
  T("mlb_toronto_blue_jays", "Toronto Blue Jays", ["Blue Jays", "Toronto", "TOR", "Jays"], "Baseball", "MLB", "Pro", "Toronto", "Ontario", "Canada", ["royal_blue", "navy", "white"]),
  T("mlb_washington_nationals", "Washington Nationals", ["Nationals", "Washington", "WAS", "Nats"], "Baseball", "MLB", "Pro", "Washington", "District of Columbia", "USA", ["red", "white", "navy"]),
];

// ── NHL (32 teams) ───────────────────────────────────────────────────

const NHL: TeamData[] = [
  T("nhl_anaheim_ducks", "Anaheim Ducks", ["Ducks", "Anaheim", "ANA"], "Hockey", "NHL", "Pro", "Anaheim", "California", "USA", ["orange", "black", "gold"]),
  T("nhl_boston_bruins", "Boston Bruins", ["Bruins", "Boston", "BOS", "B's"], "Hockey", "NHL", "Pro", "Boston", "Massachusetts", "USA", ["black", "gold", "white"]),
  T("nhl_buffalo_sabres", "Buffalo Sabres", ["Sabres", "Buffalo", "BUF"], "Hockey", "NHL", "Pro", "Buffalo", "New York", "USA", ["royal_blue", "gold", "white"]),
  T("nhl_calgary_flames", "Calgary Flames", ["Flames", "Calgary", "CGY"], "Hockey", "NHL", "Pro", "Calgary", "Alberta", "Canada", ["red", "yellow", "black"]),
  T("nhl_carolina_hurricanes", "Carolina Hurricanes", ["Hurricanes", "Carolina", "CAR", "Canes"], "Hockey", "NHL", "Pro", "Raleigh", "North Carolina", "USA", ["red", "black", "white"]),
  T("nhl_chicago_blackhawks", "Chicago Blackhawks", ["Blackhawks", "Chicago", "CHI", "Hawks"], "Hockey", "NHL", "Pro", "Chicago", "Illinois", "USA", ["red", "black", "white"]),
  T("nhl_colorado_avalanche", "Colorado Avalanche", ["Avalanche", "Colorado", "COL", "Avs"], "Hockey", "NHL", "Pro", "Denver", "Colorado", "USA", ["burgundy", "steel_blue", "silver"]),
  T("nhl_columbus_blue_jackets", "Columbus Blue Jackets", ["Blue Jackets", "Columbus", "CBJ", "Jackets"], "Hockey", "NHL", "Pro", "Columbus", "Ohio", "USA", ["blue", "red", "white"]),
  T("nhl_dallas_stars", "Dallas Stars", ["Stars", "Dallas", "DAL"], "Hockey", "NHL", "Pro", "Dallas", "Texas", "USA", ["green", "black", "silver"]),
  T("nhl_detroit_red_wings", "Detroit Red Wings", ["Red Wings", "Detroit", "DET", "Wings"], "Hockey", "NHL", "Pro", "Detroit", "Michigan", "USA", ["red", "white"]),
  T("nhl_edmonton_oilers", "Edmonton Oilers", ["Oilers", "Edmonton", "EDM"], "Hockey", "NHL", "Pro", "Edmonton", "Alberta", "Canada", ["orange", "blue", "white"]),
  T("nhl_florida_panthers", "Florida Panthers", ["Panthers", "Florida", "FLA", "Cats"], "Hockey", "NHL", "Pro", "Sunrise", "Florida", "USA", ["red", "blue", "gold"]),
  T("nhl_los_angeles_kings", "Los Angeles Kings", ["Kings", "LA Kings", "LAK"], "Hockey", "NHL", "Pro", "Los Angeles", "California", "USA", ["black", "silver", "white"]),
  T("nhl_minnesota_wild", "Minnesota Wild", ["Wild", "Minnesota", "MIN"], "Hockey", "NHL", "Pro", "Saint Paul", "Minnesota", "USA", ["green", "red", "wheat"]),
  T("nhl_montreal_canadiens", "Montreal Canadiens", ["Canadiens", "Montreal", "MTL", "Habs"], "Hockey", "NHL", "Pro", "Montreal", "Quebec", "Canada", ["red", "blue", "white"]),
  T("nhl_nashville_predators", "Nashville Predators", ["Predators", "Nashville", "NSH", "Preds"], "Hockey", "NHL", "Pro", "Nashville", "Tennessee", "USA", ["gold", "navy", "white"]),
  T("nhl_new_jersey_devils", "New Jersey Devils", ["Devils", "New Jersey", "NJ", "Devs"], "Hockey", "NHL", "Pro", "Newark", "New Jersey", "USA", ["red", "black", "white"]),
  T("nhl_new_york_islanders", "New York Islanders", ["Islanders", "NY Islanders", "NYI", "Isles"], "Hockey", "NHL", "Pro", "Elmont", "New York", "USA", ["royal_blue", "orange", "white"]),
  T("nhl_new_york_rangers", "New York Rangers", ["Rangers", "NY Rangers", "NYR", "Blueshirts"], "Hockey", "NHL", "Pro", "New York City", "New York", "USA", ["blue", "red", "white"]),
  T("nhl_ottawa_senators", "Ottawa Senators", ["Senators", "Ottawa", "OTT", "Sens"], "Hockey", "NHL", "Pro", "Ottawa", "Ontario", "Canada", ["red", "black", "white"]),
  T("nhl_philadelphia_flyers", "Philadelphia Flyers", ["Flyers", "Philadelphia", "PHI"], "Hockey", "NHL", "Pro", "Philadelphia", "Pennsylvania", "USA", ["orange", "black", "white"]),
  T("nhl_pittsburgh_penguins", "Pittsburgh Penguins", ["Penguins", "Pittsburgh", "PIT", "Pens"], "Hockey", "NHL", "Pro", "Pittsburgh", "Pennsylvania", "USA", ["black", "gold", "white"]),
  T("nhl_san_jose_sharks", "San Jose Sharks", ["Sharks", "San Jose", "SJ"], "Hockey", "NHL", "Pro", "San Jose", "California", "USA", ["teal", "black", "orange"]),
  T("nhl_seattle_kraken", "Seattle Kraken", ["Kraken", "Seattle", "SEA"], "Hockey", "NHL", "Pro", "Seattle", "Washington", "USA", ["deep_sea_blue", "ice_blue", "red"]),
  T("nhl_st_louis_blues", "St. Louis Blues", ["Blues", "St. Louis", "STL", "Note"], "Hockey", "NHL", "Pro", "St. Louis", "Missouri", "USA", ["blue", "gold", "white"]),
  T("nhl_tampa_bay_lightning", "Tampa Bay Lightning", ["Lightning", "Tampa Bay", "TBL", "Bolts"], "Hockey", "NHL", "Pro", "Tampa", "Florida", "USA", ["blue", "white", "black"]),
  T("nhl_toronto_maple_leafs", "Toronto Maple Leafs", ["Maple Leafs", "Toronto", "TOR", "Leafs", "Buds"], "Hockey", "NHL", "Pro", "Toronto", "Ontario", "Canada", ["blue", "white"]),
  T("nhl_utah_hockey_club", "Utah Hockey Club", ["Utah HC", "Utah"], "Hockey", "NHL", "Pro", "Salt Lake City", "Utah", "USA", ["black", "white", "light_blue"]),
  T("nhl_vancouver_canucks", "Vancouver Canucks", ["Canucks", "Vancouver", "VAN", "Nucks"], "Hockey", "NHL", "Pro", "Vancouver", "British Columbia", "Canada", ["blue", "green", "white"]),
  T("nhl_vegas_golden_knights", "Vegas Golden Knights", ["Golden Knights", "Vegas", "VGK", "Knights"], "Hockey", "NHL", "Pro", "Paradise", "Nevada", "USA", ["gold", "steel_gray", "red"]),
  T("nhl_washington_capitals", "Washington Capitals", ["Capitals", "Washington", "WAS", "Caps"], "Hockey", "NHL", "Pro", "Washington", "District of Columbia", "USA", ["red", "navy", "white"]),
  T("nhl_winnipeg_jets", "Winnipeg Jets", ["Jets", "Winnipeg", "WPG"], "Hockey", "NHL", "Pro", "Winnipeg", "Manitoba", "Canada", ["navy", "silver", "white"]),
];

// ── WNBA (12 teams) ──────────────────────────────────────────────────

const WNBA: TeamData[] = [
  T("wnba_atlanta_dream", "Atlanta Dream", ["Dream", "Atlanta"], "Basketball", "WNBA", "Pro", "Atlanta", "Georgia", "USA", ["red", "dark_blue", "white"]),
  T("wnba_chicago_sky", "Chicago Sky", ["Sky", "Chicago"], "Basketball", "WNBA", "Pro", "Chicago", "Illinois", "USA", ["sky_blue", "black", "white"]),
  T("wnba_connecticut_sun", "Connecticut Sun", ["Sun", "Connecticut"], "Basketball", "WNBA", "Pro", "Uncasville", "Connecticut", "USA", ["orange", "navy", "white"]),
  T("wnba_dallas_wings", "Dallas Wings", ["Wings", "Dallas"], "Basketball", "WNBA", "Pro", "Arlington", "Texas", "USA", ["navy", "lime_green", "white"]),
  T("wnba_indiana_fever", "Indiana Fever", ["Fever", "Indiana"], "Basketball", "WNBA", "Pro", "Indianapolis", "Indiana", "USA", ["red", "navy", "gold"]),
  T("wnba_las_vegas_aces", "Las Vegas Aces", ["Aces", "Las Vegas", "LV"], "Basketball", "WNBA", "Pro", "Paradise", "Nevada", "USA", ["red", "black", "gold"]),
  T("wnba_los_angeles_sparks", "Los Angeles Sparks", ["Sparks", "LA Sparks", "Los Angeles"], "Basketball", "WNBA", "Pro", "Los Angeles", "California", "USA", ["purple", "gold", "black"]),
  T("wnba_minnesota_lynx", "Minnesota Lynx", ["Lynx", "Minnesota"], "Basketball", "WNBA", "Pro", "Minneapolis", "Minnesota", "USA", ["blue", "green", "silver"]),
  T("wnba_new_york_liberty", "New York Liberty", ["Liberty", "New York", "NY"], "Basketball", "WNBA", "Pro", "Brooklyn", "New York", "USA", ["seafoam_green", "black", "white"]),
  T("wnba_phoenix_mercury", "Phoenix Mercury", ["Mercury", "Phoenix"], "Basketball", "WNBA", "Pro", "Phoenix", "Arizona", "USA", ["purple", "orange", "white"]),
  T("wnba_seattle_storm", "Seattle Storm", ["Storm", "Seattle"], "Basketball", "WNBA", "Pro", "Seattle", "Washington", "USA", ["green", "gold", "white"]),
  T("wnba_washington_mystics", "Washington Mystics", ["Mystics", "Washington", "DC"], "Basketball", "WNBA", "Pro", "Washington", "District of Columbia", "USA", ["navy", "red", "silver"]),
];

// ── NCAAF Major Programs (~25) ────────────────────────────────────────

const NCAAF: TeamData[] = [
  T("ncaaf_alabama_crimson_tide", "Alabama Crimson Tide", ["Alabama", "Bama", "Crimson Tide", "Tide"], "Football", "NCAAF", "College", "Tuscaloosa", "Alabama", "USA", ["crimson", "white"]),
  T("ncaaf_georgia_bulldogs", "Georgia Bulldogs", ["Georgia", "UGA", "Bulldogs", "Dawgs"], "Football", "NCAAF", "College", "Athens", "Georgia", "USA", ["red", "black", "white"]),
  T("ncaaf_ohio_state_buckeyes", "Ohio State Buckeyes", ["Ohio State", "OSU", "Buckeyes", "Bucks"], "Football", "NCAAF", "College", "Columbus", "Ohio", "USA", ["scarlet", "gray"]),
  T("ncaaf_michigan_wolverines", "Michigan Wolverines", ["Michigan", "UM", "Wolverines", "Blue"], "Football", "NCAAF", "College", "Ann Arbor", "Michigan", "USA", ["maize", "blue"]),
  T("ncaaf_lsu_tigers", "LSU Tigers", ["LSU", "Louisiana State", "Tigers", "Bayou Bengals"], "Football", "NCAAF", "College", "Baton Rouge", "Louisiana", "USA", ["purple", "gold"]),
  T("ncaaf_texas_longhorns", "Texas Longhorns", ["Texas", "UT", "Longhorns", "Horns"], "Football", "NCAAF", "College", "Austin", "Texas", "USA", ["burnt_orange", "white"]),
  T("ncaaf_usc_trojans", "USC Trojans", ["USC", "Southern Cal", "Trojans", "SC"], "Football", "NCAAF", "College", "Los Angeles", "California", "USA", ["cardinal", "gold"]),
  T("ncaaf_notre_dame_fighting_irish", "Notre Dame Fighting Irish", ["Notre Dame", "ND", "Fighting Irish", "Irish"], "Football", "NCAAF", "College", "South Bend", "Indiana", "USA", ["blue", "gold"]),
  T("ncaaf_clemson_tigers", "Clemson Tigers", ["Clemson", "Tigers", "Death Valley"], "Football", "NCAAF", "College", "Clemson", "South Carolina", "USA", ["orange", "regalia"]),
  T("ncaaf_florida_gators", "Florida Gators", ["Florida", "UF", "Gators"], "Football", "NCAAF", "College", "Gainesville", "Florida", "USA", ["orange", "blue"]),
  T("ncaaf_oklahoma_sooners", "Oklahoma Sooners", ["Oklahoma", "OU", "Sooners", "Boomer"], "Football", "NCAAF", "College", "Norman", "Oklahoma", "USA", ["crimson", "cream"]),
  T("ncaaf_penn_state_nittany_lions", "Penn State Nittany Lions", ["Penn State", "PSU", "Nittany Lions"], "Football", "NCAAF", "College", "State College", "Pennsylvania", "USA", ["navy", "white"]),
  T("ncaaf_florida_state_seminoles", "Florida State Seminoles", ["Florida State", "FSU", "Seminoles", "Noles"], "Football", "NCAAF", "College", "Tallahassee", "Florida", "USA", ["garnet", "gold"]),
  T("ncaaf_miami_hurricanes", "Miami Hurricanes", ["Miami", "UM", "Hurricanes", "Canes", "The U"], "Football", "NCAAF", "College", "Coral Gables", "Florida", "USA", ["orange", "green"]),
  T("ncaaf_oregon_ducks", "Oregon Ducks", ["Oregon", "UO", "Ducks", "Webfoots"], "Football", "NCAAF", "College", "Eugene", "Oregon", "USA", ["green", "yellow"]),
  T("ncaaf_tennessee_volunteers", "Tennessee Volunteers", ["Tennessee", "UT", "Volunteers", "Vols"], "Football", "NCAAF", "College", "Knoxville", "Tennessee", "USA", ["orange", "white"]),
  T("ncaaf_auburn_tigers", "Auburn Tigers", ["Auburn", "Tigers", "War Eagle"], "Football", "NCAAF", "College", "Auburn", "Alabama", "USA", ["navy", "orange"]),
  T("ncaaf_washington_huskies", "Washington Huskies", ["Washington", "UW", "Huskies", "Dawgs"], "Football", "NCAAF", "College", "Seattle", "Washington", "USA", ["purple", "gold"]),
  T("ncaaf_texas_am_aggies", "Texas A&M Aggies", ["Texas A&M", "TAMU", "Aggies", "Gig Em"], "Football", "NCAAF", "College", "College Station", "Texas", "USA", ["maroon", "white"]),
  T("ncaaf_michigan_state_spartans", "Michigan State Spartans", ["Michigan State", "MSU", "Spartans", "Sparty"], "Football", "NCAAF", "College", "East Lansing", "Michigan", "USA", ["green", "white"]),
  T("ncaaf_wisconsin_badgers", "Wisconsin Badgers", ["Wisconsin", "UW", "Badgers", "Bucky"], "Football", "NCAAF", "College", "Madison", "Wisconsin", "USA", ["red", "white"]),
  T("ncaaf_nebraska_cornhuskers", "Nebraska Cornhuskers", ["Nebraska", "NU", "Cornhuskers", "Huskers"], "Football", "NCAAF", "College", "Lincoln", "Nebraska", "USA", ["red", "cream"]),
  T("ncaaf_iowa_hawkeyes", "Iowa Hawkeyes", ["Iowa", "Hawkeyes", "Hawks"], "Football", "NCAAF", "College", "Iowa City", "Iowa", "USA", ["black", "gold"]),
  T("ncaaf_ucla_bruins", "UCLA Bruins", ["UCLA", "Bruins"], "Football", "NCAAF", "College", "Los Angeles", "California", "USA", ["ucla_blue", "gold"]),
  T("ncaaf_ole_miss_rebels", "Ole Miss Rebels", ["Ole Miss", "Mississippi", "Rebels"], "Football", "NCAAF", "College", "Oxford", "Mississippi", "USA", ["red", "navy"]),
];

// ── NCAAB Major Programs (~25) ────────────────────────────────────────

const NCAAB: TeamData[] = [
  T("ncaab_duke_blue_devils", "Duke Blue Devils", ["Duke", "Blue Devils", "Dookies"], "Basketball", "NCAAB", "College", "Durham", "North Carolina", "USA", ["duke_blue", "white"]),
  T("ncaab_north_carolina_tar_heels", "North Carolina Tar Heels", ["North Carolina", "UNC", "Tar Heels", "Heels"], "Basketball", "NCAAB", "College", "Chapel Hill", "North Carolina", "USA", ["carolina_blue", "white"]),
  T("ncaab_kentucky_wildcats", "Kentucky Wildcats", ["Kentucky", "UK", "Wildcats", "Cats", "Big Blue Nation"], "Basketball", "NCAAB", "College", "Lexington", "Kentucky", "USA", ["blue", "white"]),
  T("ncaab_kansas_jayhawks", "Kansas Jayhawks", ["Kansas", "KU", "Jayhawks", "Hawks"], "Basketball", "NCAAB", "College", "Lawrence", "Kansas", "USA", ["blue", "crimson"]),
  T("ncaab_ucla_bruins", "UCLA Bruins", ["UCLA", "Bruins"], "Basketball", "NCAAB", "College", "Los Angeles", "California", "USA", ["ucla_blue", "gold"]),
  T("ncaab_villanova_wildcats", "Villanova Wildcats", ["Villanova", "Nova", "Wildcats"], "Basketball", "NCAAB", "College", "Villanova", "Pennsylvania", "USA", ["navy", "white"]),
  T("ncaab_uconn_huskies", "UConn Huskies", ["UConn", "Connecticut", "Huskies"], "Basketball", "NCAAB", "College", "Storrs", "Connecticut", "USA", ["navy", "white"]),
  T("ncaab_michigan_state_spartans", "Michigan State Spartans", ["Michigan State", "MSU", "Spartans", "Sparty"], "Basketball", "NCAAB", "College", "East Lansing", "Michigan", "USA", ["green", "white"]),
  T("ncaab_gonzaga_bulldogs", "Gonzaga Bulldogs", ["Gonzaga", "Zags", "Bulldogs"], "Basketball", "NCAAB", "College", "Spokane", "Washington", "USA", ["navy", "red"]),
  T("ncaab_arizona_wildcats", "Arizona Wildcats", ["Arizona", "UA", "Wildcats", "Cats"], "Basketball", "NCAAB", "College", "Tucson", "Arizona", "USA", ["red", "blue"]),
  T("ncaab_indiana_hoosiers", "Indiana Hoosiers", ["Indiana", "IU", "Hoosiers"], "Basketball", "NCAAB", "College", "Bloomington", "Indiana", "USA", ["crimson", "cream"]),
  T("ncaab_louisville_cardinals", "Louisville Cardinals", ["Louisville", "UofL", "Cardinals", "Cards"], "Basketball", "NCAAB", "College", "Louisville", "Kentucky", "USA", ["red", "black"]),
  T("ncaab_purdue_boilermakers", "Purdue Boilermakers", ["Purdue", "Boilermakers", "Boilers"], "Basketball", "NCAAB", "College", "West Lafayette", "Indiana", "USA", ["black", "old_gold"]),
  T("ncaab_baylor_bears", "Baylor Bears", ["Baylor", "Bears", "Sic Em"], "Basketball", "NCAAB", "College", "Waco", "Texas", "USA", ["green", "gold"]),
  T("ncaab_houston_cougars", "Houston Cougars", ["Houston", "UH", "Cougars", "Coogs"], "Basketball", "NCAAB", "College", "Houston", "Texas", "USA", ["red", "white"]),
  T("ncaab_tennessee_volunteers", "Tennessee Volunteers", ["Tennessee", "UT", "Volunteers", "Vols"], "Basketball", "NCAAB", "College", "Knoxville", "Tennessee", "USA", ["orange", "white"]),
  T("ncaab_alabama_crimson_tide", "Alabama Crimson Tide", ["Alabama", "Bama", "Crimson Tide"], "Basketball", "NCAAB", "College", "Tuscaloosa", "Alabama", "USA", ["crimson", "white"]),
  T("ncaab_creighton_bluejays", "Creighton Bluejays", ["Creighton", "Bluejays", "Jays"], "Basketball", "NCAAB", "College", "Omaha", "Nebraska", "USA", ["blue", "white"]),
  T("ncaab_marquette_golden_eagles", "Marquette Golden Eagles", ["Marquette", "Golden Eagles", "MU"], "Basketball", "NCAAB", "College", "Milwaukee", "Wisconsin", "USA", ["blue", "gold"]),
  T("ncaab_syracuse_orange", "Syracuse Orange", ["Syracuse", "Cuse", "Orange"], "Basketball", "NCAAB", "College", "Syracuse", "New York", "USA", ["orange", "white"]),
  T("ncaab_texas_longhorns", "Texas Longhorns", ["Texas", "UT", "Longhorns", "Horns"], "Basketball", "NCAAB", "College", "Austin", "Texas", "USA", ["burnt_orange", "white"]),
  T("ncaab_virginia_cavaliers", "Virginia Cavaliers", ["Virginia", "UVA", "Cavaliers", "Hoos"], "Basketball", "NCAAB", "College", "Charlottesville", "Virginia", "USA", ["orange", "navy"]),
  T("ncaab_arkansas_razorbacks", "Arkansas Razorbacks", ["Arkansas", "Razorbacks", "Hogs"], "Basketball", "NCAAB", "College", "Fayetteville", "Arkansas", "USA", ["red", "white"]),
  T("ncaab_florida_gators", "Florida Gators", ["Florida", "UF", "Gators"], "Basketball", "NCAAB", "College", "Gainesville", "Florida", "USA", ["orange", "blue"]),
  T("ncaab_miami_hurricanes", "Miami Hurricanes", ["Miami", "UM", "Hurricanes", "Canes"], "Basketball", "NCAAB", "College", "Coral Gables", "Florida", "USA", ["orange", "green"]),
];

// ── Combined registry ─────────────────────────────────────────────────

export const ALL_TEAMS: TeamData[] = [
  ...NFL,
  ...NBA,
  ...MLB,
  ...NHL,
  ...WNBA,
  ...NCAAF,
  ...NCAAB,
];

// ── Lookup utilities ──────────────────────────────────────────────────

const teamsById = new Map<string, TeamData>();
const teamsBySport = new Map<string, TeamData[]>();
for (const team of ALL_TEAMS) {
  teamsById.set(team.id, team);
  const key = team.sport.toLowerCase();
  if (!teamsBySport.has(key)) teamsBySport.set(key, []);
  teamsBySport.get(key)!.push(team);
}

/**
 * Maps Forge sport IDs ("football", "basketball", etc.) to the canonical
 * sport string used in team data ("Football", "Basketball", etc.).
 * Also maps which leagues belong to each sport for level filtering.
 */
export const SPORT_ID_MAP: Record<string, { sport: string; proLeagues: string[]; collegeLeagues: string[] }> = {
  football: { sport: "Football", proLeagues: ["NFL"], collegeLeagues: ["NCAAF"] },
  basketball: { sport: "Basketball", proLeagues: ["NBA", "WNBA"], collegeLeagues: ["NCAAB"] },
  baseball: { sport: "Baseball", proLeagues: ["MLB"], collegeLeagues: [] },
  soccer: { sport: "Soccer", proLeagues: ["MLS", "NWSL", "EPL", "LaLiga"], collegeLeagues: [] },
  hockey: { sport: "Hockey", proLeagues: ["NHL"], collegeLeagues: [] },
};

/**
 * Get the canonical sport string for a Forge sport ID.
 */
export function getSportCanonical(sportId: string): string | undefined {
  return SPORT_ID_MAP[sportId]?.sport;
}

/**
 * Get teams filtered by Forge sport ID and optional level ("Pro" | "College").
 */
export function getTeamsBySportAndLevel(sportId: string, level?: "Pro" | "College"): TeamData[] {
  const mapping = SPORT_ID_MAP[sportId];
  if (!mapping) return [];

  const sportTeams = teamsBySport.get(mapping.sport.toLowerCase()) ?? [];
  if (!level) return sportTeams;

  const allowedLeagues = level === "Pro" ? mapping.proLeagues : mapping.collegeLeagues;
  if (allowedLeagues.length === 0) return [];

  return sportTeams.filter((t) => allowedLeagues.includes(t.league));
}

/**
 * Look up a team by its canonical ID.
 * Returns undefined if the ID is not found (which may happen for
 * mock/free-text IDs from before the canonical system was added).
 */
export function getTeamById(id: string): TeamData | undefined {
  return teamsById.get(id);
}

/**
 * Look up teams by an array of canonical IDs.
 * Unknown IDs are silently dropped.
 */
export function getTeamsByIds(ids: string[]): TeamData[] {
  return ids.map((id) => teamsById.get(id)).filter((t): t is TeamData => !!t);
}

/**
 * Search teams by query string.
 * Matches against display_name, aliases, city, league, sport, and state.
 * Returns matches sorted by relevance (exact alias match > display_name starts-with > other).
 */
export function searchTeams(query: string, options?: { sport?: string; level?: "Pro" | "College" }): TeamData[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  // Determine candidate pool
  let pool = ALL_TEAMS;
  if (options?.sport) {
    const sportCanonical = getSportCanonical(options.sport);
    if (sportCanonical) {
      pool = getTeamsBySportAndLevel(options.sport, options.level);
    }
  }

  const exactAlias: TeamData[] = [];
  const startsWith: TeamData[] = [];
  const contains: TeamData[] = [];

  for (const team of pool) {
    // Exact alias match
    if (team.aliases.some((a) => a.toLowerCase() === q)) {
      exactAlias.push(team);
      continue;
    }
    // Display name starts with
    if (team.display_name.toLowerCase().startsWith(q)) {
      startsWith.push(team);
      continue;
    }
    // Any field contains
    const searchable = [
      team.display_name,
      ...team.aliases,
      team.city,
      team.league,
      team.sport,
      team.state,
    ].join(" ").toLowerCase();
    if (searchable.includes(q)) {
      contains.push(team);
    }
  }

  return [...exactAlias, ...startsWith, ...contains];
}

/**
 * Get all teams for a specific sport or league.
 */
export function getTeamsBySport(sport: string): TeamData[] {
  const s = sport.toLowerCase();
  return ALL_TEAMS.filter((t) => t.sport.toLowerCase() === s);
}

export function getTeamsByLeague(league: string): TeamData[] {
  const l = league.toUpperCase();
  return ALL_TEAMS.filter((t) => t.league.toUpperCase() === l);
}
