export type AssignmentRole = 'bar' | 'kitchen' | 'storekeeper';

export function isAssignedToRole(assignedTo: any, role: AssignmentRole): boolean {
  if (!assignedTo) return false;
  if (Array.isArray(assignedTo)) {
    return assignedTo.includes(role);
  }
  if (typeof assignedTo === 'object' && assignedTo !== null) {
    return Boolean(assignedTo[role]);
  }
  return false;
}