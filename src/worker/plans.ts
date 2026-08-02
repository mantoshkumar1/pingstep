export type PlanCode = 'trial' | 'pro' | 'team';

export type PlanPolicy = {
  code: PlanCode;
  label: string;
  maxJobs: number;
  maxRunsPer30Days: number;
  minimumUpdateIntervalSeconds: number;
};

export const PLAN_POLICIES: Record<PlanCode, PlanPolicy> = {
  trial: { code: 'trial', label: 'Free trial', maxJobs: 2, maxRunsPer30Days: 10, minimumUpdateIntervalSeconds: 30 },
  pro: { code: 'pro', label: 'Pro', maxJobs: 10, maxRunsPer30Days: 2_000, minimumUpdateIntervalSeconds: 15 },
  team: { code: 'team', label: 'Team', maxJobs: 50, maxRunsPer30Days: 10_000, minimumUpdateIntervalSeconds: 15 }
};

export function policyFor(value: string | null | undefined): PlanPolicy {
  return value === 'pro' || value === 'team' ? PLAN_POLICIES[value] : PLAN_POLICIES.trial;
}

export function rollingWindowStart(now = new Date()): string {
  return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
}

