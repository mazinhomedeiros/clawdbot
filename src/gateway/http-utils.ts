import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

import { buildAgentMainSessionKey, normalizeAgentId } from "../routing/session-key.js";
import { isLoopbackAddress, isTrustedProxyAddress } from "./net.js";

export function getHeader(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name.toLowerCase()];
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return undefined;
}

export function getBearerToken(req: IncomingMessage): string | undefined {
  const raw = getHeader(req, "authorization")?.trim() ?? "";
  if (!raw.toLowerCase().startsWith("bearer ")) {
    return undefined;
  }
  const token = raw.slice(7).trim();
  return token || undefined;
}

export type GatewayAuthTokenSource = "bearer" | "header" | "query";

export function resolveGatewayAuthToken(params: {
  req: IncomingMessage;
  url?: URL;
  trustedProxies?: string[];
}): { token?: string; source?: GatewayAuthTokenSource } {
  const bearer = getBearerToken(params.req);
  if (bearer) {
    return { token: bearer, source: "bearer" };
  }
  const headerToken = getHeader(params.req, "x-openclaw-token")?.trim();
  if (headerToken) {
    return { token: headerToken, source: "header" };
  }
  const queryToken = params.url?.searchParams.get("token")?.trim();
  if (queryToken && isSecureQueryTokenRequest(params.req, params.trustedProxies)) {
    return { token: queryToken, source: "query" };
  }
  return { token: undefined };
}

function isSecureQueryTokenRequest(req: IncomingMessage, trustedProxies?: string[]): boolean {
  if ((req.socket as { encrypted?: boolean }).encrypted) {
    return true;
  }
  const remoteAddr = req.socket?.remoteAddress;
  if (isLoopbackAddress(remoteAddr)) {
    return true;
  }
  const forwardedProto = getHeader(req, "x-forwarded-proto")?.trim().toLowerCase();
  if (!forwardedProto || (forwardedProto !== "https" && forwardedProto !== "wss")) {
    return false;
  }
  if (!trustedProxies || trustedProxies.length === 0) {
    return false;
  }
  return isTrustedProxyAddress(remoteAddr, trustedProxies);
}

export function resolveAgentIdFromHeader(req: IncomingMessage): string | undefined {
  const raw =
    getHeader(req, "x-openclaw-agent-id")?.trim() ||
    getHeader(req, "x-openclaw-agent")?.trim() ||
    "";
  if (!raw) {
    return undefined;
  }
  return normalizeAgentId(raw);
}

export function resolveAgentIdFromModel(model: string | undefined): string | undefined {
  const raw = model?.trim();
  if (!raw) {
    return undefined;
  }

  const m =
    raw.match(/^openclaw[:/](?<agentId>[a-z0-9][a-z0-9_-]{0,63})$/i) ??
    raw.match(/^agent:(?<agentId>[a-z0-9][a-z0-9_-]{0,63})$/i);
  const agentId = m?.groups?.agentId;
  if (!agentId) {
    return undefined;
  }
  return normalizeAgentId(agentId);
}

export function resolveAgentIdForRequest(params: {
  req: IncomingMessage;
  model: string | undefined;
}): string {
  const fromHeader = resolveAgentIdFromHeader(params.req);
  if (fromHeader) {
    return fromHeader;
  }

  const fromModel = resolveAgentIdFromModel(params.model);
  return fromModel ?? "main";
}

export function resolveSessionKey(params: {
  req: IncomingMessage;
  agentId: string;
  user?: string | undefined;
  prefix: string;
}): string {
  const explicit = getHeader(params.req, "x-openclaw-session-key")?.trim();
  if (explicit) {
    return explicit;
  }

  const user = params.user?.trim();
  const mainKey = user ? `${params.prefix}-user:${user}` : `${params.prefix}:${randomUUID()}`;
  return buildAgentMainSessionKey({ agentId: params.agentId, mainKey });
}
