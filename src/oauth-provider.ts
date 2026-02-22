import { randomUUID, createHash } from "node:crypto";

interface OAuthClient {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  created_at: number;
}

interface AuthorizationCode {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  expires_at: number;
}

interface AccessToken {
  token: string;
  client_id: string;
  scope: string;
  expires_at: number;
}

const clients = new Map<string, OAuthClient>();
const authorizationCodes = new Map<string, AuthorizationCode>();
const accessTokens = new Map<string, AccessToken>();

export function getServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp:tools"],
  };
}

export function getProtectedResourceMetadata(resourceUrl: string, authServerUrl: string) {
  return {
    resource: resourceUrl,
    authorization_servers: [authServerUrl],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp:tools"],
  };
}

export function registerClient(body: Record<string, unknown>): OAuthClient | { error: string } {
  const redirect_uris = body.redirect_uris as string[] | undefined;
  if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return { error: "redirect_uris is required and must contain at least one URI" };
  }
  for (const uri of redirect_uris) {
    try {
      new URL(uri);
    } catch {
      return { error: `Invalid redirect URI: ${uri}` };
    }
  }

  const client_id = randomUUID();
  const client: OAuthClient = {
    client_id,
    client_name: (body.client_name as string) || "MCP Client",
    redirect_uris,
    grant_types: (body.grant_types as string[]) || ["authorization_code"],
    response_types: (body.response_types as string[]) || ["code"],
    token_endpoint_auth_method: (body.token_endpoint_auth_method as string) || "none",
    created_at: Date.now(),
  };
  clients.set(client_id, client);
  return client;
}

export function isClientRedirectValid(client: OAuthClient, redirectUri: string): boolean {
  return client.redirect_uris.includes(redirectUri);
}

export function getClient(clientId: string): OAuthClient | undefined {
  return clients.get(clientId);
}

export function createAuthorizationCode(params: {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
}): string {
  const code = randomUUID();
  authorizationCodes.set(code, {
    code,
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    code_challenge: params.code_challenge,
    code_challenge_method: params.code_challenge_method,
    scope: params.scope,
    expires_at: Date.now() + 10 * 60 * 1000,
  });
  return code;
}

export function exchangeCode(
  code: string,
  clientId: string,
  codeVerifier: string,
  redirectUri: string
): AccessToken | null {
  const authCode = authorizationCodes.get(code);
  if (!authCode) return null;
  if (authCode.client_id !== clientId) return null;
  if (authCode.redirect_uri !== redirectUri) return null;
  if (authCode.expires_at < Date.now()) {
    authorizationCodes.delete(code);
    return null;
  }

  const expectedChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  if (expectedChallenge !== authCode.code_challenge) {
    return null;
  }

  authorizationCodes.delete(code);

  const token: AccessToken = {
    token: randomUUID(),
    client_id: clientId,
    scope: authCode.scope,
    expires_at: Date.now() + 24 * 60 * 60 * 1000,
  };
  accessTokens.set(token.token, token);
  return token;
}

export function validateAccessToken(tokenStr: string): AccessToken | null {
  const token = accessTokens.get(tokenStr);
  if (!token) return null;
  if (token.expires_at < Date.now()) {
    accessTokens.delete(tokenStr);
    return null;
  }
  return token;
}
