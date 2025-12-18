export function getYearMonth(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  return y * 100 + m;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
