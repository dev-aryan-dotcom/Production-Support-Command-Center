import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommandCenterStore } from '../data/command-center.store';

@Component({
  selector: 'app-coverage-tab',
  templateUrl: './coverage-tab.component.html',
  styleUrl: './coverage-tab.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CoverageTabComponent {
  private readonly store = inject(CommandCenterStore);

  readonly platforms = this.store.coveragePlatforms;
  readonly coverage = this.store.coverageData;
}
