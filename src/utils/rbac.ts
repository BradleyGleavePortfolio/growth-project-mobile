import { User } from '../types';

export function canAccessResource(
  currentUser: User,
  resourceUserId: string,
  resourceCoachId: string
): boolean {
  if (currentUser.role === 'client') return resourceUserId === currentUser.id;
  if (currentUser.role === 'coach') return resourceCoachId === currentUser.id;
  return false;
}
