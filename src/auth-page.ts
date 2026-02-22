export function renderAuthorizationPage(params: {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  client_name?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TastyTrade MCP - Authorization</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #1e293b;
      border-radius: 12px;
      padding: 2rem;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 4px 24px rgba(0,0,0,0.3);
    }
    h1 { font-size: 1.3rem; margin-bottom: 0.5rem; color: #f8fafc; }
    .subtitle { color: #94a3b8; margin-bottom: 1.5rem; font-size: 0.9rem; }
    .client-info {
      background: #0f172a;
      border-radius: 8px;
      padding: 0.75rem 1rem;
      margin-bottom: 1.5rem;
      font-size: 0.85rem;
      color: #94a3b8;
    }
    .client-info strong { color: #e2e8f0; }
    label { display: block; margin-bottom: 0.4rem; font-size: 0.9rem; color: #cbd5e1; }
    input[type="password"] {
      width: 100%;
      padding: 0.65rem 0.75rem;
      border: 1px solid #334155;
      border-radius: 8px;
      background: #0f172a;
      color: #f8fafc;
      font-size: 0.95rem;
      margin-bottom: 1rem;
    }
    input[type="password"]:focus { outline: none; border-color: #3b82f6; }
    .buttons { display: flex; gap: 0.75rem; }
    button {
      flex: 1;
      padding: 0.65rem;
      border: none;
      border-radius: 8px;
      font-size: 0.95rem;
      cursor: pointer;
      font-weight: 500;
    }
    .btn-approve { background: #3b82f6; color: #fff; }
    .btn-approve:hover { background: #2563eb; }
    .btn-deny { background: #334155; color: #e2e8f0; }
    .btn-deny:hover { background: #475569; }
    .error { color: #f87171; font-size: 0.85rem; margin-bottom: 0.75rem; display: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authorize MCP Access</h1>
    <p class="subtitle">An application is requesting access to your TastyTrade MCP server.</p>
    <div class="client-info">
      <strong>${escapeHtml(params.client_name || "MCP Client")}</strong> wants to access your MCP tools.
      <br>Scope: <strong>${escapeHtml(params.scope || "mcp:tools")}</strong>
    </div>
    <form method="POST" action="/oauth/authorize/submit">
      <input type="hidden" name="client_id" value="${escapeHtml(params.client_id)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirect_uri)}">
      <input type="hidden" name="state" value="${escapeHtml(params.state)}">
      <input type="hidden" name="code_challenge" value="${escapeHtml(params.code_challenge)}">
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(params.code_challenge_method)}">
      <input type="hidden" name="scope" value="${escapeHtml(params.scope)}">
      <label for="token">Enter your MCP Bearer Token</label>
      <input type="password" id="token" name="token" placeholder="Your MCP_BEARER_TOKEN" required>
      <p class="error" id="error-msg">Invalid token</p>
      <div class="buttons">
        <button type="button" class="btn-deny" onclick="denyAccess()">Deny</button>
        <button type="submit" class="btn-approve">Authorize</button>
      </div>
    </form>
  </div>
  <script>
    function denyAccess() {
      const redirectUri = document.querySelector('input[name="redirect_uri"]').value;
      const state = document.querySelector('input[name="state"]').value;
      const url = new URL(redirectUri);
      url.searchParams.set('error', 'access_denied');
      url.searchParams.set('error_description', 'User denied authorization');
      if (state) url.searchParams.set('state', state);
      window.location.href = url.toString();
    }
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
