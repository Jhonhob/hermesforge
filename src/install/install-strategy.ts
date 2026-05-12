import type { SetupDependencyRepairId } from "../shared/types";
import type {
  InstallOptions,
  InstallPlan,
  InstallPublisher,
  InstallStrategyKind,
  InstallStrategyRepairResult,
  InstallStrategyResult,
  InstallStrategyUpdateResult,
} from "./install-types";

export interface InstallStrategy {
  readonly kind: InstallStrategyKind;
  plan(options?: InstallOptions): Promise<InstallPlan>;
  install(publish?: InstallPublisher, options?: InstallOptions): Promise<InstallStrategyResult>;
  cancelInstall?(): Promise<{ ok: boolean; message: string }>;
  update(): Promise<InstallStrategyUpdateResult>;
  repairDependency(id: SetupDependencyRepairId): Promise<InstallStrategyRepairResult>;
}
