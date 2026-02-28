export function assertServerOnly(moduleName: string): void {
  if (typeof window !== "undefined" && !process.env.VITEST) {
    throw new Error(`${moduleName} can only be used on the server.`);
  }
}
