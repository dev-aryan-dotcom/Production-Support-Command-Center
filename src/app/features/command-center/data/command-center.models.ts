export type Severity = 'P1' | 'P2' | 'P3' | 'P4';
export type Tier = 'L1' | 'L2' | 'L3';
export type Environment = 'Prod' | 'Staging' | 'Dev';
export type CoverageLevel = 'Full' | 'Partial' | 'None';

export interface IncidentRecord {
  id: string;
  platform: string;
  severity: Severity;
  tier: Tier;
  env: Environment;
  opened: string;
  openedAt: number;
  resolvedAt: string | null;
  resolvedAtMs: number | null;
  resolvedMins: number | null;
  error: string;
  solution: string;
  tags: string[];
  status: 'Active' | 'Being Resolved' | 'Resolved';
}

export interface Incident extends IncidentRecord {
  status: 'Active' | 'Being Resolved';
  resolvedMins: number | null;
}

export interface IncidentHistory extends IncidentRecord {
  status: 'Resolved';
  resolvedMins: number;
}

export interface TeamMember {
  name: string;
  level: Tier;
  skills: string;
  cert: number;
  oncall: boolean;
}

export interface SlaTargetRecord {
  id: string;
  severity: Severity;
  tier: Tier;
  responseMins: number;
  resolutionMins: number;
}

export interface SlaSnapshotRecord {
  id: string;
  kind: 'rolling-48h' | 'monthly';
  windowStartMs: number;
  windowEndMs: number;
  totalIncidents: number;
  metIncidents: number;
  compliancePercent: number;
  calculatedAtMs: number;
  monthKey: string | null;
}
