export interface Config {
  host: string;
  port: number;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const host = env.HOST || "127.0.0.1";
  const rawPort = env.PORT;
  let port = 4280;
  if (rawPort !== undefined && rawPort !== "") {
    port = Number(rawPort);
    if (!/^\d+$/.test(rawPort) || port < 1 || port > 65535) {
      throw new Error(
        `Invalid PORT "${rawPort}": expected an integer 1-65535.`,
      );
    }
  }
  return { host, port };
}
