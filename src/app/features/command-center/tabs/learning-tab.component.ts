import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-learning-tab',
  templateUrl: './learning-tab.component.html',
  styleUrl: './learning-tab.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LearningTabComponent {}
