import { Providers } from "./providers";
import { shuffle } from "./utils";

export class Secrets {
  static env: Env | undefined;
  static readonly loaded: { [key: string]: string[] } = {};

  static configure(env: Env) {
    Secrets.env = env;
  }

  static availables(): (keyof Env)[] {
    const availables = Object.keys(Providers)
      .map((key) => {
        const keyName = Providers[key].args.apiKey;
        return Secrets.env && Secrets.env[keyName] ? keyName : null;
      })
      .filter((key) => key !== null) as (keyof Env)[];

    return availables;
  }

  static isAvailable(keyName: keyof Env): boolean {
    const value = Secrets.getAll(keyName);

    return value.length > 0;
  }

  static getAll(keyName: keyof Env): string[] {
    if (Secrets.env === undefined) {
      return [];
    }

    const value = Secrets.env[keyName];
    if (value === undefined) {
      return [];
    }

    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return value.split(",");
    }
  }

  static get(keyName: keyof Env, rotate: boolean = true): string {
    if (rotate) {
      if (!Secrets.loaded[keyName]) {
        Secrets.loaded[keyName] = shuffle(this.getAll(keyName));
      }

      const apiKey = Secrets.loaded[keyName][0];
      Secrets.loaded[keyName].push(Secrets.loaded[keyName].shift() as string);

      return apiKey;
    }

    const secrets = shuffle(this.getAll(keyName));
    return secrets[0];
  }
}
