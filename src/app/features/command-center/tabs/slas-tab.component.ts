import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CommandCenterStore } from '../data/command-center.store';
import { Severity, Tier } from '../data/command-center.models';

@Component({
  selector: 'app-slas-tab',
  templateUrl: './slas-tab.component.html',
  styleUrl: './slas-tab.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SlasTabComponent {
  private readonly store = inject(CommandCenterStore);

  readonly monthlySla = this.store.monthlySlaCompliance;
  readonly monthlyTarget = this.store.monthlySlaTargetPercent;
  readonly latest48hSnapshot = this.store.latestRolling48hSnapshot;

  readonly targetRows = computed(() => {
    const severities: Severity[] = ['P1', 'P2', 'P3', 'P4'];
    const tiers: Tier[] = ['L1', 'L2', 'L3'];
    const targets = this.store.slaTargets();

    return severities.map((severity) => {
      const valuesByTier = tiers.map((tier) => {
        const target = targets.find((item) => item.severity === severity && item.tier === tier);
        return target
          ? `${target.responseMins} / ${target.resolutionMins}`
          : '-';
      });

      return {
        severity,
        valuesByTier
      };
    });
  });
}
