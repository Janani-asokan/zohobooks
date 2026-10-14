export const STAFF_ROLES = ['Manager', 'Accountant', 'Sales Staff', 'Viewer'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
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
  'reports.read': 'View reports & GST returns',
  'admin': 'Organization profile, staff, branches, recurring & settings',
} as const;
export type Permission = keyof typeof PERMISSIONS;

const ALL = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  Owner: ALL,
  Manager: ALL.filter((p) => p !== 'admin'),
  Accountant: ['sales.write', 'payments.write', 'customers.write', 'items.cost', 'purchases.read', 'purchases.write', 'banking.read', 'banking.write', 'reports.read'],
  'Sales Staff': ['sales.write', 'payments.write', 'customers.write'],
  Viewer: ['items.cost', 'purchases.read', 'banking.read', 'reports.read'],
};

export const can = (role: UserRole, p: Permission) => ROLE_PERMISSIONS[role]?.includes(p) ?? false;

/** Password policy shared by server validation and the UI hint. */
export const PASSWORD_RULE = 'At least 8 characters, including a letter and a number';
export const isStrongPassword = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
