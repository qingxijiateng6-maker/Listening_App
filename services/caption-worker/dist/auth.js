export function isAuthorizedRequest(request, expectedToken) {
    if (!expectedToken) {
        return false;
    }
    const header = request.headers.authorization ?? "";
    if (!header.toLowerCase().startsWith("bearer ")) {
        return false;
    }
    return header.slice("bearer ".length).trim() === expectedToken;
}
