import { reactive } from 'vue';
import { errorKey } from './errors';

// Short messages at the top of the screen, such as the reason the server refused something.

export interface Toast {
  id: number;
  key: string;
  params: Record<string, unknown>;
}

export const toasts = reactive<Toast[]>([]);
let nextId = 1;

export function dismiss(id: number): void {
  const index = toasts.findIndex((toast) => toast.id === id);
  if (index !== -1) toasts.splice(index, 1);
}

export function toast(key: string, params: Record<string, unknown> = {}, ms = 4000): void {
  const id = nextId;
  nextId += 1;
  toasts.push({ id, key, params });
  if (toasts.length > 3) toasts.splice(0, toasts.length - 3);
  setTimeout(() => dismiss(id), ms);
}

export const toastError = (code: string): void => toast(errorKey(code));
