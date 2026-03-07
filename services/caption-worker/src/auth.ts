import type { FastifyRequest } from "fastify";

export function isAuthorizedRequest(request: FastifyRequest, expectedToken: string): boolean {
  if (!expectedToken) {
    return false;
  }

  const header = request.headers.authorization ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) {
    return false;
  }

  return header.slice("bearer ".length).trim() === expectedToken;
}
