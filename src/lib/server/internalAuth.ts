import { NextRequest } from "next/server";

function readBearerToken(request: NextRequest): string {
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return authHeader.slice("bearer ".length).trim();
}

export function isAuthorizedCronRequest(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET ?? "";
  if (!expected) {
    return false;
  }
  return readBearerToken(request) === expected;
}

export function isAuthorizedWorkerRequest(request: NextRequest): boolean {
  const expected = process.env.WORKER_SECRET ?? "";
  if (!expected) {
    return false;
  }
  return readBearerToken(request) === expected;
}
