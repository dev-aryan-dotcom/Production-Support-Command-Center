import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { IncidentRecord, SlaSnapshotRecord, SlaTargetRecord } from './command-center.models';

@Injectable({ providedIn: 'root' })
export class IncidentApiService {
  private static readonly API_BASE_URL = 'https://ixnccxqiwe.execute-api.us-east-1.amazonaws.com/dev/incidents';
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${IncidentApiService.API_BASE_URL}/incidents`;
  private readonly slaTargetsUrl = `${IncidentApiService.API_BASE_URL}/slaTargets`;
  private readonly slaSnapshotsUrl = `${IncidentApiService.API_BASE_URL}/slaSnapshots`;

  getIncidents(): Observable<IncidentRecord[]> {
    return this.http.get<IncidentRecord[]>(this.baseUrl);
  }

  createIncident(incident: Omit<IncidentRecord, 'id'>): Observable<IncidentRecord> {
    return this.http.post<IncidentRecord>(this.baseUrl, incident);
  }

  updateIncident(id: string, incident: IncidentRecord): Observable<IncidentRecord> {
    return this.http.put<IncidentRecord>(`${this.baseUrl}/${id}`, incident);
  }

  deleteIncident(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  getSlaTargets(): Observable<SlaTargetRecord[]> {
    return this.http.get<SlaTargetRecord[]>(this.slaTargetsUrl);
  }

  upsertSlaTarget(target: SlaTargetRecord): Observable<SlaTargetRecord> {
    return this.http.put<SlaTargetRecord>(`${this.slaTargetsUrl}/${target.id}`, target);
  }

  getSlaSnapshots(): Observable<SlaSnapshotRecord[]> {
    return this.http.get<SlaSnapshotRecord[]>(this.slaSnapshotsUrl);
  }

  upsertSlaSnapshot(snapshot: SlaSnapshotRecord): Observable<SlaSnapshotRecord> {
    return this.http.put<SlaSnapshotRecord>(`${this.slaSnapshotsUrl}/${snapshot.id}`, snapshot);
  }
}
