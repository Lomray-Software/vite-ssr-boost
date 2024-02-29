export interface IDevActionParams {
  host?: boolean;
  resetCache?: boolean;
  mode?: string;
}

export interface IBuildActionParams {
  onlyClient?: boolean;
  clientOptions?: string;
  serverOptions?: string;
  mode?: string;
  unlockRobots?: boolean;
  eject?: boolean;
  serverless?: boolean;
  throwWarnings?: boolean;
}

export interface IStartActionParams {
  host?: boolean;
  port?: number;
  onlyClient?: boolean;
  modulePreload?: boolean;
  buildDir?: string;
}

export interface IPreviewActionParams extends IStartActionParams {
  mode?: string;
}

export interface IBuildDockerActionParams {
  imageName: string;
  dockerOptions?: string;
  dockerFile?: string;
  onlyClient?: boolean;
  mode?: string;
}

export interface IBuildAmplifyActionParams {
  manifestFile?: string;
  mode?: string;
  isOptimize?: boolean;
}

export interface IBuildVercelActionParams {
  configFile?: string;
  configVcFile?: string;
  mode?: string;
  isOptimize?: boolean;
}
