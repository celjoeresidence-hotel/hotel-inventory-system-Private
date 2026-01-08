export type AssignmentRole = 'bar' | 'kitchen' | 'storekeeper';

export function isAssignedToRole(assignedTo: unknown, role: AssignmentRole): boolean {
  if (!assignedTo) return false;
  if (Array.isArray(assignedTo)) {
    return (assignedTo as unknown[]).some(r => String(r).toLowerCase() === role.toLowerCase());
  }
  if (typeof assignedTo === 'object' && assignedTo !== null) {
    const record = assignedTo as Record<string, unknown>;
    // Check direct key
    if (record[role]) return true;
    // Check case-insensitive key
    const lowerRole = role.toLowerCase();
    return Object.keys(record).some(k => k.toLowerCase() === lowerRole && record[k]);
  }
  return false;
}
