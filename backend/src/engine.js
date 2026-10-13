// Pure and deterministic. Nothing in here comes from the user.
const SOURCE = { SCHEDULED: 0, USER: 2, DEADLINE: 3, EMERGENCY: 5 };
const IMPACT = { ROUTINE: 1, NORMAL: 2, FINANCIAL: 3, LEGAL: 5, SECURITY: 5 };

// default deadline window in hours per category (null = no deadline)
export const SLA_HOURS = { LEGAL: 2, FINANCIAL: 1, SECURITY: 0.25, NORMAL: 24, ROUTINE: null };

export function classify(filename = '') {
  const f = filename.toLowerCase();
  if (/incident|security|breach/.test(f)) return 'SECURITY';
  if (/contract|agreement|legal/.test(f)) return 'LEGAL';
  if (/invoice|bill|payment/.test(f)) return 'FINANCIAL';
  if (/policy|memo/.test(f)) return 'NORMAL';
  return 'ROUTINE';
}

export function deadlinePressure(hoursLeft) {
  if (hoursLeft == null) return 0;
  if (hoursLeft <= 0.5) return 5;
  if (hoursLeft <= 2) return 4;
  if (hoursLeft <= 6) return 3;
  if (hoursLeft <= 24) return 2;
  if (hoursLeft <= 72) return 1;
  return 0;
}

export function score({ source, category }) {
  const sla = SLA_HOURS[category];
  const total = Math.round(
    35 * (SOURCE[source] / 5) +
    30 * (IMPACT[category] / 5) +
    35 * (deadlinePressure(sla) / 5)
  );
  const priority = total >= 65 ? 'HIGH' : total >= 30 ? 'MEDIUM' : 'LOW';
  const deadline = sla == null ? 'no deadline' : `deadline ${sla < 1 ? sla * 60 + 'min' : sla + 'h'}`;
  const reason = `${priority}: ${source.toLowerCase()} event, ${category.toLowerCase()} document, ${deadline} (score ${total})`;
  return { score: total, priority, reason };
}