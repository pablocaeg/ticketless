import type { Ticket } from "../types.js";

export interface DemoUser {
  id: string;
  email: string;
  name: string;
  plan: "free" | "starter" | "pro" | "enterprise";
  status: "active" | "locked" | "suspended" | "churned";
  signupDate: string;
  lastLogin: string;
  failedLoginAttempts: number;
  lockoutExpiresAt: string | null;
  billingCycleEnd: string;
  monthlySpend: number;
}

export interface DemoOrder {
  id: string;
  userId: string;
  product: string;
  amount: number;
  status: "completed" | "pending" | "failed" | "refunded";
  createdAt: string;
  error: string | null;
}

export interface DemoLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  service: string;
  userId: string | null;
  message: string;
  stackTrace: string | null;
}

export const DEMO_USERS: DemoUser[] = [
  {
    id: "usr_001",
    email: "alice@startup.io",
    name: "Alice Chen",
    plan: "pro",
    status: "locked",
    signupDate: "2024-03-15",
    lastLogin: "2025-05-26T14:22:00Z",
    failedLoginAttempts: 5,
    lockoutExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    billingCycleEnd: "2025-06-15",
    monthlySpend: 49,
  },
  {
    id: "usr_002",
    email: "bob@acmecorp.com",
    name: "Bob Martinez",
    plan: "enterprise",
    status: "active",
    signupDate: "2023-08-01",
    lastLogin: "2025-05-27T09:00:00Z",
    failedLoginAttempts: 0,
    lockoutExpiresAt: null,
    billingCycleEnd: "2025-06-01",
    monthlySpend: 299,
  },
  {
    id: "usr_003",
    email: "carol@freelance.dev",
    name: "Carol Nguyen",
    plan: "starter",
    status: "active",
    signupDate: "2025-01-10",
    lastLogin: "2025-05-25T18:30:00Z",
    failedLoginAttempts: 0,
    lockoutExpiresAt: null,
    billingCycleEnd: "2025-06-10",
    monthlySpend: 19,
  },
  {
    id: "usr_004",
    email: "dave@bigco.com",
    name: "Dave Wilson",
    plan: "pro",
    status: "active",
    signupDate: "2024-11-20",
    lastLogin: "2025-05-27T08:15:00Z",
    failedLoginAttempts: 0,
    lockoutExpiresAt: null,
    billingCycleEnd: "2025-06-20",
    monthlySpend: 49,
  },
  {
    id: "usr_005",
    email: "eve@techstart.co",
    name: "Eve Park",
    plan: "free",
    status: "churned",
    signupDate: "2024-06-01",
    lastLogin: "2025-03-10T12:00:00Z",
    failedLoginAttempts: 0,
    lockoutExpiresAt: null,
    billingCycleEnd: "2025-04-01",
    monthlySpend: 0,
  },
];

export const DEMO_ORDERS: DemoOrder[] = [
  { id: "ord_001", userId: "usr_002", product: "Enterprise Annual License", amount: 3588, status: "completed", createdAt: "2025-05-01T10:00:00Z", error: null },
  { id: "ord_002", userId: "usr_002", product: "API Add-on Pack", amount: 99, status: "failed", createdAt: "2025-05-26T15:30:00Z", error: "Payment method declined: card expired" },
  { id: "ord_003", userId: "usr_003", product: "Starter Monthly", amount: 19, status: "completed", createdAt: "2025-05-10T08:00:00Z", error: null },
  { id: "ord_004", userId: "usr_004", product: "Pro Monthly", amount: 49, status: "completed", createdAt: "2025-05-20T09:00:00Z", error: null },
  { id: "ord_005", userId: "usr_004", product: "Extra Seats (3)", amount: 30, status: "pending", createdAt: "2025-05-27T07:00:00Z", error: null },
  { id: "ord_006", userId: "usr_001", product: "Pro Monthly", amount: 49, status: "completed", createdAt: "2025-05-15T10:00:00Z", error: null },
];

export const DEMO_LOGS: DemoLogEntry[] = [
  { timestamp: "2025-05-27T08:45:00Z", level: "error", service: "auth", userId: "usr_001", message: "Login failed: account locked after 5 attempts", stackTrace: null },
  { timestamp: "2025-05-27T08:44:00Z", level: "warn", service: "auth", userId: "usr_001", message: "Failed login attempt 5/5 — locking account", stackTrace: null },
  { timestamp: "2025-05-27T08:43:00Z", level: "warn", service: "auth", userId: "usr_001", message: "Failed login attempt 4/5", stackTrace: null },
  { timestamp: "2025-05-26T15:31:00Z", level: "error", service: "billing", userId: "usr_002", message: "Payment failed for order ord_002: card expired (Visa ending 4242, exp 03/25)", stackTrace: null },
  { timestamp: "2025-05-26T15:30:00Z", level: "info", service: "billing", userId: "usr_002", message: "Processing payment for API Add-on Pack ($99)", stackTrace: null },
  { timestamp: "2025-05-27T07:01:00Z", level: "error", service: "provisioning", userId: "usr_004", message: "Seat provisioning stuck: timeout waiting for license server response after 30s", stackTrace: "Error: ETIMEDOUT\n    at LicenseClient.provision (license-client.ts:142)\n    at SeatManager.addSeats (seat-manager.ts:89)" },
  { timestamp: "2025-05-27T07:00:00Z", level: "info", service: "orders", userId: "usr_004", message: "Order ord_005 created: Extra Seats (3) for $30", stackTrace: null },
  { timestamp: "2025-05-25T18:35:00Z", level: "error", service: "export", userId: "usr_003", message: "CSV export failed: row count exceeds starter plan limit (1000 rows). Upgrade to Pro for unlimited exports.", stackTrace: null },
  { timestamp: "2025-05-25T18:30:00Z", level: "info", service: "export", userId: "usr_003", message: "Export initiated: project 'Q2 Analytics' (2,847 rows)", stackTrace: null },
];

export const DEMO_TICKETS: Ticket[] = [
  {
    id: "demo-001",
    source: "demo",
    subject: "Can't log into my account",
    body: "Hi, I've been trying to log in for the past 10 minutes but it keeps saying my credentials are wrong. I'm sure I'm using the right password. This is urgent — I have a client presentation in an hour.",
    customerEmail: "alice@startup.io",
    metadata: {},
    createdAt: new Date(),
  },
  {
    id: "demo-002",
    source: "demo",
    subject: "Payment failed on API add-on",
    body: "I tried to purchase the API Add-on Pack yesterday but the payment didn't go through. I need this urgently for a project deadline. Can you check what's wrong with my payment?",
    customerEmail: "bob@acmecorp.com",
    metadata: {},
    createdAt: new Date(),
  },
  {
    id: "demo-003",
    source: "demo",
    subject: "Export not working",
    body: "I tried to export my Q2 Analytics project as CSV but it just fails with no useful error message. I was able to export smaller projects fine. What's going on?",
    customerEmail: "carol@freelance.dev",
    metadata: {},
    createdAt: new Date(),
  },
  {
    id: "demo-004",
    source: "demo",
    subject: "Purchased extra seats but they're not showing up",
    body: "I bought 3 extra seats about an hour ago and got charged, but when I go to team settings the seat count hasn't changed. My team members still can't be invited.",
    customerEmail: "dave@bigco.com",
    metadata: {},
    createdAt: new Date(),
  },
];
