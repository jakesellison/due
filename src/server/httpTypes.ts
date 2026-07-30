import type { IncomingHttpHeaders } from 'http';

export interface ApiRequest {
  method?: string;
  headers: IncomingHttpHeaders;
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface ApiResponse {
  status(code: number): ApiResponse;
  setHeader(name: string, value: number | string | readonly string[]): ApiResponse;
  json(body: unknown): ApiResponse;
  send(body: unknown): ApiResponse;
  redirect(url: string): ApiResponse;
  redirect(status: number, url: string): ApiResponse;
}
