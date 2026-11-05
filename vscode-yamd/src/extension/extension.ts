import * as vscode from 'vscode';
import { registerAliases } from './companions/aliases';
import { registerBuildCommands } from './build/buildCommands';
import { registerExportCommands } from './build/exportCommands';
import { registerQueryCommands } from './query/queryCommands';
import { registerWidgetDiagnostics } from './widgets/widgetDiagnostics';
import { registerWidgetPanels } from './widgets/widgetPanel';
import { DashboardPanel } from '../study/dashboard';
import { registerStudy } from '../study/register';
import { ReviewPanel } from '../study/review';
import { StudyIndex } from '../study/studyIndex';
import { StudyTimer } from '../study/timer';

export function activate(context: vscode.ExtensionContext): void {
  const studyIndex = new StudyIndex();
  const reviewPanel = new ReviewPanel(context.extensionUri, studyIndex);
  const dashboard = new DashboardPanel(studyIndex);
  const timer = new StudyTimer();
  context.subscriptions.push(studyIndex, reviewPanel, dashboard, timer);

  registerWidgetDiagnostics(context);
  registerWidgetPanels(context);
  registerQueryCommands(context);
  registerBuildCommands(context);
  registerExportCommands(context);
  registerAliases(context);
  registerStudy(context, studyIndex, reviewPanel, dashboard, timer);
}

export function deactivate(): void {}
