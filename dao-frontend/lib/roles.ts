export type AppRole = 'client' | 'contractor' | 'dao_reviewer' | 'dao_admin';

export function isDaoStaff(roles: AppRole[]) {
  return roles.includes('dao_reviewer') || roles.includes('dao_admin');
}

export function isStaffOnly(roles: AppRole[]) {
  return isDaoStaff(roles) && !roles.includes('client') && !roles.includes('contractor');
}
