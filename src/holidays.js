export const STATES = {
  BW: "Baden-Württemberg",
  BY: "Bayern",
  BE: "Berlin",
  BB: "Brandenburg",
  HB: "Bremen",
  HH: "Hamburg",
  HE: "Hessen",
  MV: "Mecklenburg-Vorpommern",
  NI: "Niedersachsen",
  NW: "Nordrhein-Westfalen",
  RP: "Rheinland-Pfalz",
  SL: "Saarland",
  SN: "Sachsen",
  ST: "Sachsen-Anhalt",
  SH: "Schleswig-Holstein",
  TH: "Thüringen",
};
export function easter(year) {
  const a = year % 19,
    b = Math.floor(year / 100),
    c = year % 100,
    d = Math.floor(b / 4),
    e = b % 4,
    f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3),
    h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4),
    k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7,
    m = Math.floor((a + 11 * h + 22 * l) / 451),
    n = h + l - 7 * m + 114;
  return new Date(Date.UTC(year, Math.floor(n / 31) - 1, (n % 31) + 1));
}
export function holidays(year, state = "NI", local = {}) {
  const out = new Map();
  const add = (month, day, name) =>
    out.set(
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      name,
    );
  const offset = (days, name) => {
    const d = easter(year);
    d.setUTCDate(d.getUTCDate() + days);
    out.set(d.toISOString().slice(0, 10), name);
  };
  add(1, 1, "Neujahr");
  offset(-2, "Karfreitag");
  offset(1, "Ostermontag");
  add(5, 1, "Tag der Arbeit");
  offset(39, "Christi Himmelfahrt");
  offset(50, "Pfingstmontag");
  if (year >= 1990) add(10, 3, "Tag der Deutschen Einheit");
  if (year >= 1954 && year <= 1989) add(6, 17, "Tag der deutschen Einheit");
  add(12, 25, "1. Weihnachtstag");
  add(12, 26, "2. Weihnachtstag");
  if (["BW", "BY", "ST"].includes(state)) add(1, 6, "Heilige Drei Könige");
  if (
    ["BW", "BY", "HE", "NW", "RP", "SL"].includes(state) ||
    (["SN", "TH"].includes(state) && local.corpusChristi)
  )
    offset(60, "Fronleichnam");
  if (state === "SL" || (state === "BY" && local.assumption))
    add(8, 15, "Mariä Himmelfahrt");
  if (state === "BY" && local.augsburg) add(8, 8, "Augsburger Friedensfest");
  if (["BW", "BY", "NW", "RP", "SL"].includes(state))
    add(11, 1, "Allerheiligen");
  if (
    year === 2017 ||
    ["BB", "MV", "SN", "ST", "TH"].includes(state) ||
    (year >= 2018 && ["HB", "HH", "NI", "SH"].includes(state))
  )
    add(10, 31, "Reformationstag");
  if ((state === "BE" && year >= 2019) || (state === "MV" && year >= 2023))
    add(3, 8, "Internationaler Frauentag");
  if (state === "TH" && year >= 2019) add(9, 20, "Weltkindertag");
  if (state === "BB") {
    offset(0, "Ostersonntag");
    offset(49, "Pfingstsonntag");
  }
  if (state === "SN" || year <= 1994) {
    const d = new Date(Date.UTC(year, 10, 22));
    while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() - 1);
    out.set(d.toISOString().slice(0, 10), "Buß- und Bettag");
  }
  if ((state === "BE" && year === 2020) || (state === "BE" && year === 2025))
    add(5, 8, "Tag der Befreiung");
  return out;
}
