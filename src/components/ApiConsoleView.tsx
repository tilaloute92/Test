import { useState } from 'react';
import { useStore } from '../store/useStore';
import { Card } from './ui';
import { useConfirm } from './ConfirmProvider';
import type { ApiAuthType, ApiConnection, HttpMethod, KeyValue } from '../types';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const AUTH_LABELS: Record<ApiAuthType, string> = {
  none: 'Aucune',
  bearer: 'Jeton Bearer',
  apiKey: 'Clé API (header)',
  basic: 'Basic Auth',
};
const SENSITIVE_HEADER_NAMES = new Set(['authorization']);

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (!path) return base;
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

function maskHeaders(headers: KeyValue[], apiKeyHeader?: string): KeyValue[] {
  const sensitiveKey = apiKeyHeader?.toLowerCase();
  return headers.map((h) =>
    SENSITIVE_HEADER_NAMES.has(h.key.toLowerCase()) || (sensitiveKey && h.key.toLowerCase() === sensitiveKey)
      ? { key: h.key, value: '••••••••' }
      : h
  );
}

function prettyBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

interface ResponseState {
  status: number | null;
  statusText: string;
  headers: KeyValue[];
  body: string;
  durationMs: number;
  error?: string;
}

export function ApiConsoleView() {
  const { apiConnections, requestHistory, addApiConnection, updateApiConnection, removeApiConnection, addRequestLog, clearRequestHistory } = useStore();
  const confirm = useConfirm();

  const [showConnForm, setShowConnForm] = useState(false);
  const [editingConn, setEditingConn] = useState<ApiConnection | null>(null);

  const [connectionId, setConnectionId] = useState<string | null>(apiConnections[0]?.id ?? null);
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [path, setPath] = useState('');
  const [freeUrl, setFreeUrl] = useState('https://');
  const [sessionSecret, setSessionSecret] = useState('');
  const [extraHeaders, setExtraHeaders] = useState<KeyValue[]>([{ key: '', value: '' }]);
  const [body, setBody] = useState('{\n  \n}');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ResponseState | null>(null);

  const connection = apiConnections.find((c) => c.id === connectionId) ?? null;
  const targetUrl = connection ? joinUrl(connection.baseUrl, path) : freeUrl;
  const needsBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
  const needsInlineSecret = connection && connection.authType !== 'none' && !connection.rememberSecret;

  const runRequest = async () => {
    if (!targetUrl || targetUrl === 'https://') return;
    setLoading(true);
    setResponse(null);
    const start = performance.now();

    const headers: KeyValue[] = [...(connection?.headers ?? []), ...extraHeaders.filter((h) => h.key.trim())];
    const secret = connection?.rememberSecret ? connection.secret : sessionSecret;

    if (connection && connection.authType !== 'none' && secret) {
      if (connection.authType === 'bearer') headers.push({ key: 'Authorization', value: `Bearer ${secret}` });
      else if (connection.authType === 'apiKey' && connection.apiKeyHeader) headers.push({ key: connection.apiKeyHeader, value: secret });
      else if (connection.authType === 'basic') headers.push({ key: 'Authorization', value: `Basic ${btoa(`${connection.username ?? ''}:${secret}`)}` });
    }

    const headerRecord: Record<string, string> = {};
    for (const h of headers) headerRecord[h.key] = h.value;

    try {
      const res = await fetch(targetUrl, {
        method,
        headers: headerRecord,
        body: needsBody && body.trim() ? body : undefined,
      });
      const text = await res.text();
      const durationMs = Math.round(performance.now() - start);
      const responseHeaders: KeyValue[] = [...res.headers.entries()].map(([key, value]) => ({ key, value }));
      setResponse({ status: res.status, statusText: res.statusText, headers: responseHeaders, body: text, durationMs });
      addRequestLog({
        timestamp: new Date().toISOString(),
        connectionId,
        method,
        url: targetUrl,
        requestHeaders: maskHeaders(headers, connection?.apiKeyHeader),
        requestBody: needsBody ? body : undefined,
        status: res.status,
        statusText: res.statusText,
        durationMs,
        responseBody: text.slice(0, 20000),
      });
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      const message = err instanceof Error ? err.message : String(err);
      setResponse({ status: null, statusText: 'Erreur', headers: [], body: '', durationMs, error: message });
      addRequestLog({
        timestamp: new Date().toISOString(),
        connectionId,
        method,
        url: targetUrl,
        requestHeaders: maskHeaders(headers, connection?.apiKeyHeader),
        requestBody: needsBody ? body : undefined,
        status: null,
        statusText: 'Erreur',
        durationMs,
        responseBody: '',
        error: message,
      });
    } finally {
      setLoading(false);
    }
  };

  const statusColor = (status: number | null) => {
    if (status === null) return 'text-red-600 dark:text-red-400';
    if (status < 300) return 'text-emerald-600 dark:text-emerald-400';
    if (status < 400) return 'text-sky-600 dark:text-sky-400';
    if (status < 500) return 'text-amber-600 dark:text-amber-400';
    return 'text-red-600 dark:text-red-400';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Requêtes API</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Console pour interroger des applications externes (ticketing, supervision, etc.) directement depuis le navigateur.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Le navigateur exécute ces appels : l'API distante doit autoriser les requêtes cross-origin (CORS) depuis cette page, sinon la
          requête sera bloquée par le navigateur.
        </p>
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Connexions enregistrées</h2>
          <button onClick={() => setShowConnForm(true)} className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700">
            + Nouvelle connexion
          </button>
        </div>
        {apiConnections.length === 0 && <p className="text-xs text-slate-400">Aucune connexion enregistrée. Ajoutes-en une, ou utilise l'URL libre ci-dessous.</p>}
        <div className="space-y-1.5">
          {apiConnections.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800">
              <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{c.name}</span>
              <span className="truncate text-xs text-slate-400">{c.baseUrl}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                {AUTH_LABELS[c.authType]}
              </span>
              {!c.rememberSecret && c.authType !== 'none' && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                  secret non mémorisé
                </span>
              )}
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => {
                    setConnectionId(c.id);
                    setPath('');
                    setSessionSecret('');
                    setExtraHeaders([{ key: '', value: '' }]);
                  }}
                  className="rounded px-2 py-1 text-xs text-violet-600 hover:bg-violet-50 dark:text-violet-400 dark:hover:bg-violet-500/10"
                >
                  Utiliser
                </button>
                <button onClick={() => setEditingConn(c)} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                  Modifier
                </button>
                <button
                  onClick={async () => {
                    if (await confirm({ title: 'Supprimer la connexion', message: `Supprimer définitivement la connexion "${c.name}" ?`, confirmLabel: 'Supprimer', danger: true })) {
                      removeApiConnection(c.id);
                      if (connectionId === c.id) setConnectionId(null);
                    }
                  }}
                  className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                >
                  Suppr.
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Nouvelle requête</h2>

        <div className="flex flex-wrap gap-2">
          <select
            value={connectionId ?? ''}
            onChange={(e) => setConnectionId(e.target.value || null)}
            className="input max-w-64"
          >
            <option value="">— URL libre —</option>
            {apiConnections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)} className="input w-28">
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {connection ? (
            <input placeholder="/chemin (ex : /todos/1)" value={path} onChange={(e) => setPath(e.target.value)} className="input min-w-56 flex-1" />
          ) : (
            <input placeholder="https://api.exemple.com/..." value={freeUrl} onChange={(e) => setFreeUrl(e.target.value)} className="input min-w-56 flex-1" />
          )}
        </div>
        <p className="truncate text-xs text-slate-400">URL appelée : {targetUrl}</p>

        {needsInlineSecret && (
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
              {connection?.authType === 'basic' ? 'Mot de passe' : connection?.authType === 'apiKey' ? 'Clé API' : 'Jeton'} (non mémorisé, saisie pour cette session)
            </span>
            <input type="password" value={sessionSecret} onChange={(e) => setSessionSecret(e.target.value)} className="input max-w-sm" />
          </label>
        )}

        <div>
          <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">En-têtes additionnels</span>
          <HeaderEditor headers={extraHeaders} onChange={setExtraHeaders} />
        </div>

        {needsBody && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-slate-500 dark:text-slate-400">Corps (JSON)</span>
              <button onClick={() => setBody(prettyBody(body))} className="text-xs text-violet-600 hover:underline dark:text-violet-400">
                Formater JSON
              </button>
            </div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} className="input font-mono text-xs" />
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={runRequest}
            disabled={loading || !targetUrl || targetUrl === 'https://'}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
          >
            {loading ? 'Envoi…' : 'Envoyer'}
          </button>
        </div>
      </Card>

      {response && (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Réponse</h2>
            <span className={`text-sm font-semibold tabular-nums ${statusColor(response.status)}`}>
              {response.status ?? '—'} {response.statusText}
            </span>
            <span className="text-xs text-slate-400">{response.durationMs} ms</span>
          </div>
          {response.error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
              {response.error} — vérifie l'URL, la connectivité, ou que l'API autorise les requêtes CORS depuis ce site.
            </div>
          )}
          {response.headers.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-slate-500 dark:text-slate-400">En-têtes de réponse ({response.headers.length})</summary>
              <div className="mt-1 space-y-0.5 text-slate-500 dark:text-slate-400">
                {response.headers.map((h) => (
                  <div key={h.key} className="truncate">
                    <span className="text-slate-700 dark:text-slate-200">{h.key}</span>: {h.value}
                  </div>
                ))}
              </div>
            </details>
          )}
          {response.body && (
            <pre className="max-h-96 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
              {prettyBody(response.body)}
            </pre>
          )}
        </Card>
      )}

      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Historique</h2>
          {requestHistory.length > 0 && (
            <button
              onClick={async () => {
                if (await confirm({ title: "Vider l'historique", message: `Supprimer les ${requestHistory.length} requête(s) de l'historique ?`, confirmLabel: 'Vider', danger: true })) {
                  clearRequestHistory();
                }
              }}
              className="text-xs text-slate-400 hover:text-red-500"
            >
              Vider
            </button>
          )}
        </div>
        {requestHistory.length === 0 && <p className="text-xs text-slate-400">Aucune requête envoyée pour l'instant.</p>}
        <div className="divide-y divide-slate-50 dark:divide-slate-800/60">
          {requestHistory.map((h) => (
            <button
              key={h.id}
              onClick={() => {
                setConnectionId(h.connectionId);
                setMethod(h.method);
                if (h.connectionId) {
                  const c = apiConnections.find((cc) => cc.id === h.connectionId);
                  setPath(c ? h.url.replace(c.baseUrl.replace(/\/+$/, ''), '') : '');
                } else {
                  setFreeUrl(h.url);
                }
                if (h.requestBody) setBody(h.requestBody);
              }}
              className="flex w-full items-center gap-3 py-2 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40"
            >
              <span className="w-16 shrink-0 font-mono font-medium text-slate-600 dark:text-slate-300">{h.method}</span>
              <span className="min-w-0 flex-1 truncate text-slate-500 dark:text-slate-400">{h.url}</span>
              <span className={`w-14 shrink-0 text-right font-medium tabular-nums ${statusColor(h.status)}`}>{h.status ?? 'ERR'}</span>
              <span className="w-16 shrink-0 text-right text-slate-400">{h.durationMs} ms</span>
            </button>
          ))}
        </div>
      </Card>

      {(showConnForm || editingConn) && (
        <ConnectionForm
          initial={editingConn ?? undefined}
          onCancel={() => {
            setShowConnForm(false);
            setEditingConn(null);
          }}
          onSave={async (payload) => {
            if (editingConn) {
              if (await confirm({ title: 'Confirmer la modification', message: `Enregistrer les modifications apportées à la connexion "${editingConn.name}" ?` })) {
                updateApiConnection(editingConn.id, payload);
                setEditingConn(null);
              }
            } else {
              addApiConnection(payload);
              setShowConnForm(false);
            }
          }}
        />
      )}
    </div>
  );
}

function HeaderEditor({ headers, onChange }: { headers: KeyValue[]; onChange: (h: KeyValue[]) => void }) {
  const update = (i: number, patch: Partial<KeyValue>) => {
    const next = headers.map((h, idx) => (idx === i ? { ...h, ...patch } : h));
    onChange(next);
  };
  return (
    <div className="space-y-1.5">
      {headers.map((h, i) => (
        <div key={i} className="flex gap-1.5">
          <input placeholder="Nom" value={h.key} onChange={(e) => update(i, { key: e.target.value })} className="input" />
          <input placeholder="Valeur" value={h.value} onChange={(e) => update(i, { value: e.target.value })} className="input" />
          <button
            onClick={() => onChange(headers.filter((_, idx) => idx !== i))}
            className="rounded px-2 text-xs text-slate-300 hover:text-red-500"
          >
            ✕
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...headers, { key: '', value: '' }])} className="text-xs text-violet-600 hover:underline dark:text-violet-400">
        + En-tête
      </button>
    </div>
  );
}

function ConnectionForm({
  initial,
  onCancel,
  onSave,
}: {
  initial?: ApiConnection;
  onCancel: () => void;
  onSave: (p: Omit<ApiConnection, 'id'>) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? 'https://');
  const [authType, setAuthType] = useState<ApiAuthType>(initial?.authType ?? 'none');
  const [apiKeyHeader, setApiKeyHeader] = useState(initial?.apiKeyHeader ?? 'X-API-Key');
  const [username, setUsername] = useState(initial?.username ?? '');
  const [rememberSecret, setRememberSecret] = useState(initial?.rememberSecret ?? false);
  const [secret, setSecret] = useState(initial?.secret ?? '');
  const [headers, setHeaders] = useState<KeyValue[]>(initial?.headers.length ? initial.headers : [{ key: 'Accept', value: 'application/json' }]);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-4 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">{initial ? 'Modifier la connexion' : 'Nouvelle connexion API'}</h3>
        <div className="space-y-2.5">
          <input placeholder="Nom (ex : GLPI - Ticketing)" value={name} onChange={(e) => setName(e.target.value)} className="input" />
          <input placeholder="URL de base (ex : https://api.exemple.com)" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="input" />

          <label className="block">
            <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Authentification</span>
            <select value={authType} onChange={(e) => setAuthType(e.target.value as ApiAuthType)} className="input">
              {(Object.entries(AUTH_LABELS) as [ApiAuthType, string][]).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>

          {authType === 'apiKey' && (
            <input placeholder="Nom de l'en-tête (ex : X-API-Key)" value={apiKeyHeader} onChange={(e) => setApiKeyHeader(e.target.value)} className="input" />
          )}
          {authType === 'basic' && <input placeholder="Nom d'utilisateur" value={username} onChange={(e) => setUsername(e.target.value)} className="input" />}

          {authType !== 'none' && (
            <>
              <input
                type="password"
                placeholder={authType === 'basic' ? 'Mot de passe' : authType === 'apiKey' ? 'Clé API' : 'Jeton'}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                className="input"
              />
              <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <input type="checkbox" checked={rememberSecret} onChange={(e) => setRememberSecret(e.target.checked)} />
                Mémoriser ce secret dans ce navigateur (stocké en clair dans le stockage local)
              </label>
            </>
          )}

          <div>
            <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">En-têtes par défaut</span>
            <HeaderEditor headers={headers} onChange={setHeaders} />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800">
            Annuler
          </button>
          <button
            disabled={!name.trim() || !baseUrl.trim()}
            onClick={() =>
              onSave({
                name: name.trim(),
                baseUrl: baseUrl.trim(),
                authType,
                apiKeyHeader: authType === 'apiKey' ? apiKeyHeader.trim() : undefined,
                username: authType === 'basic' ? username.trim() : undefined,
                rememberSecret,
                secret: secret || undefined,
                headers: headers.filter((h) => h.key.trim()),
              })
            }
            className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
          >
            {initial ? 'Enregistrer' : 'Ajouter'}
          </button>
        </div>
      </div>
    </div>
  );
}
