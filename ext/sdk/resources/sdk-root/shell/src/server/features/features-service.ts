import fs from 'fs';
import cp from 'child_process';
import { inject, injectable } from "inversify";
import { ApiClient } from "server/api/api-client";
import { StatusService } from "server/status/status-service";
import { AppContribution } from "server/app/app-contribution";
import { Deferred } from "server/deferred";
import { FsService } from "server/fs/fs-service";
import { LogService } from "server/logger/log-service";
import { featuresStatuses } from "shared/api.statuses";
import { Feature, FeaturesMap } from "shared/api.types";

@injectable()
export class FeaturesService implements AppContribution {
  protected defers: Partial<Record<Feature, Deferred<boolean>>> = {};

  @inject(ApiClient)
  protected readonly apiClient: ApiClient;

  @inject(StatusService)
  protected readonly statusService: StatusService;

  @inject(FsService)
  protected readonly fsService: FsService;

  @inject(LogService)
  protected readonly logService: LogService;

  boot() {
    this.probeFeatures();
  }

  async get(feature: Feature): Promise<boolean> {
    const featureState = this.state[feature];

    if (typeof featureState === 'boolean') {
      return featureState;
    }

    let featureDefer = this.defers[feature];
    if (!featureDefer) {
      featureDefer = this.defers[feature] = new Deferred();
    }

    return featureDefer.promise;
  }

  private get state(): FeaturesMap {
    return this.statusService.get<FeaturesMap>(featuresStatuses.state) || {};
  }

  private resolveFeature(feature: Feature, featureState: boolean) {
    const state = this.state;

    state[feature] = featureState;

    this.statusService.set(featuresStatuses.state, state);

    const featureDefer = this.defers[feature];
    if (featureDefer) {
      featureDefer.resolve(featureState);
    }

    this.logService.log(`Feature "${Feature[feature]}"? ${featureState}.`);
  }

  private async probeFeatures() {
    this.logService.log('Start probing features...');

    // Checking windows dev mode enabled by trying to create directory symlink
    {
      let windowsDevModeEnabled: boolean;

      const tmpdir = this.fsService.tmpdir();

      const source = this.fsService.joinPath(tmpdir, '__fxdk_devmode_feature_probe_source');
      const target = this.fsService.joinPath(tmpdir, '__fxdk_devmode_feature_probe_target');


      await Promise.all([
        await this.fsService.rimraf(source),
        await this.fsService.rimraf(target),
      ]);

      await this.fsService.mkdirp(source);

      try {
        await fs.promises.symlink(source, target, 'dir');

        windowsDevModeEnabled = true;
      } catch (e) {
        windowsDevModeEnabled = false;
      }

      this.resolveFeature(Feature.windowsDevModeEnabled, windowsDevModeEnabled);

      await Promise.all([
        await this.fsService.rimraf(source),
        await this.fsService.rimraf(target),
      ]);
    }

    // Checking system git client installed
    {
      await new Promise((resolve) => {
        let systemGitClientAvailable: boolean;

        try {
          const response = cp.execSync('git --version').toString();

          systemGitClientAvailable = response.startsWith('git version');
        } catch (e) {
          systemGitClientAvailable = false;
        }

        this.resolveFeature(Feature.systemGitClientAvailable, systemGitClientAvailable);

        resolve();
      });
    }
  }
}
