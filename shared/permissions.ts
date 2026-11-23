export const STAFF_ROLES = ['Manager', 'Accountant', 'Sales Staff', 'Warehouse', 'Collector', 'Compliance Manager', 'Viewer'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
/** Roles offered when adding or changing staff. Collector (for the removed microfinance module) stays valid for old users only. */
export const HIRABLE_ROLES = STAFF_ROLES.filter((r) => r !== 'Collector');
export type UserRole = 'Owner' | StaffRole;

export const PERMISSIONS = {
  'sales.write': 'Create & edit invoices, sales orders, POS bills',
  'payments.write': 'Record customer payments',
  'customers.write': 'Manage customers',
  'items.write': 'Manage items, pricing & stock',
  'items.cost': 'See item cost price & margins',
  'purchases.read': 'View purchases',
  'purchases.write': 'Record purchases & vendors',
  'banking.read': 'View banking',
  'banking.write': 'Record bank transactions',
  'accounting.read': 'View chart of accounts, journals & ledgers',
  'accounting.write': 'Add accounts & post manual journals',
  'reports.read': 'View reports & GST returns',
  'audit.read': 'View the audit log',
  'field.view': 'See field staff visits, routes and locations',
  'attendance.manage': 'Staff attendance: see everyone’s check-ins and selfies, mark by hand, set shop locations',
  'lending.read': 'Microfinance: see borrowers, loans, dues and reports',
  'lending.write': 'Microfinance: register borrowers, give and close loans, late charges',
  'lending.collect': 'Microfinance: collect instalments (without “see” access, only loans assigned to them)',
  'licenses.read': 'Warehouse licences: see licences, expiry and alerts',
  'licenses.write': 'Warehouse licences: add, renew, suspend and change capacity',
  'licenses.override': 'Warehouse licences: grant grace periods and issue invoices past a blocked licence (with a reason)',
  'admin': 'Organization profile, staff, branches, recurring & settings',
} as const;
export type Permission = keyof typeof PERMISSIONS;

const ALL = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  Owner: ALL,
  Manager: ALL.filter((p) => p !== 'admin'),
  Accountant: ['sales.write', 'payments.write', 'customers.write', 'items.cost', 'purchases.read', 'purchases.write', 'banking.read', 'banking.write', 'accounting.read', 'accounting.write', 'reports.read', 'audit.read', 'lending.read', 'licenses.read'],
  'Sales Staff': ['sales.write', 'payments.write', 'customers.write'],
  Warehouse: ['items.write', 'purchases.read', 'licenses.read'],
  Collector: ['lending.collect'],
  'Compliance Manager': ['licenses.read', 'licenses.write', 'licenses.override', 'audit.read', 'reports.read'],
  Viewer: ['items.cost', 'purchases.read', 'banking.read', 'accounting.read', 'reports.read', 'lending.read', 'licenses.read'],
};

/** Permission groups for the roles matrix, in the order of the sidebar. */
export const PERMISSION_GROUPS: Array<{ module: string; permissions: Permission[] }> = [
  { module: 'Sales', permissions: ['sales.write', 'payments.write', 'customers.write'] },
  { module: 'Inventory', permissions: ['items.write', 'items.cost'] },
  { module: 'Purchases', permissions: ['purchases.read', 'purchases.write'] },
  { module: 'Accounting', permissions: ['banking.read', 'banking.write', 'accounting.read', 'accounting.write'] },
  { module: 'Reports', permissions: ['reports.read'] },
  { module: 'Warehouse licences', permissions: ['licenses.read', 'licenses.write', 'licenses.override'] },
  { module: 'Staff', permissions: ['field.view', 'attendance.manage'] },
  { module: 'Administration', permissions: ['audit.read', 'admin'] },
];

/** Only the owner holds admin; it lets a user manage staff and permissions, so it can't be granted. */
export const GRANTABLE: Permission[] = ALL.filter((p) => p !== 'admin');

/** A role's permissions in one shop: the shop's own setting when it has one, else the defaults. */
export function rolePermissions(role: UserRole, custom?: readonly string[] | null): Permission[] {
  if (role === 'Owner') return ALL;
  if (!custom) return ROLE_PERMISSIONS[role] ?? [];
  return GRANTABLE.filter((p) => custom.includes(p));
}

export const can = (role: UserRole, p: Permission) => ROLE_PERMISSIONS[role]?.includes(p) ?? false;

/** Password policy shared by server validation and the UI hint. */
export const PASSWORD_RULE = 'At least 8 characters, including a letter and a number';
export const isStrongPassword = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
