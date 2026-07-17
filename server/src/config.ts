export interface AppConfig {
  dataDir: string;
  sessionTtlDays: number;
  bootstrapUser?: string;
  bootstrapPassword?: string;
}

export function configFromEnv(): AppConfig & { port: number } {
  const config: AppConfig & { port: number } = {
    dataDir: process.env["KIRIKO_DATA_DIR"] ?? "./data",
    sessionTtlDays: 30,
    port: Number(process.env["KIRIKO_PORT"] ?? 8790),
  };
  const user = process.env["KIRIKO_BOOTSTRAP_USER"];
  const password = process.env["KIRIKO_BOOTSTRAP_PASSWORD"];
  if (user !== undefined && password !== undefined) {
    config.bootstrapUser = user;
    config.bootstrapPassword = password;
  }
  return config;
}
