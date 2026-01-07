export type AssignmentRole = 'bar' | 'kitchen' | 'storekeeper';

export function isAssignedToRole(assignedTo: unknown, role: AssignmentRole): boolean {
  if (!assignedTo) return false;
  if (Array.isArray(assignedTo)) return (assignedTo as unknown[]).includes(role);
  if (typeof assignedTo === 'object' && assignedTo !== null) return Boolean((assignedTo as Record<string, unknown>)[role]);
  return false;
}
