import { combine } from "zustand/middleware";
import type { Toast, ToastType } from "../dashboard/ToastNotification";

export interface FeedbackState {
  toasts: Toast[];
  loadingStates: Record<string, boolean>;
}

export interface FeedbackActions {
  addToast(toast: Omit<Toast, "id">): void;
  removeToast(id: string): void;
  success(message: string, detail?: string): void;
  error(message: string, detail?: string): void;
  warning(message: string, detail?: string): void;
  info(message: string, detail?: string): void;
  setLoading(key: string, loading: boolean): void;
  isLoading(key: string): boolean;
  startLoading(key: string): void;
  stopLoading(key: string): void;
}

export const feedbackSlice = combine<FeedbackState, FeedbackActions>(
  {
    toasts: [],
    loadingStates: {},
  },
  (set, get) => ({
    addToast: (toast: Omit<Toast, "id">) =>
      set((state) => {
        const isDuplicate = state.toasts.some((t) => t.type === toast.type && t.title === toast.title && t.message === toast.message);
        if (isDuplicate) return state;
        return { toasts: [...state.toasts, { ...toast, id: `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` }] };
      }),
    removeToast: (id: string) =>
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
    success: (message: string, detail?: string) =>
      set((state) => {
        if (state.toasts.some((t) => t.type === "success" && t.title === message && t.message === detail)) return state;
        return { toasts: [...state.toasts, { type: "success", title: message, message: detail, id: `toast-${Date.now()}` }] };
      }),
    error: (message: string, detail?: string) =>
      set((state) => {
        if (state.toasts.some((t) => t.type === "error" && t.title === message && t.message === detail)) return state;
        return { toasts: [...state.toasts, { type: "error", title: message, message: detail, id: `toast-${Date.now()}` }] };
      }),
    warning: (message: string, detail?: string) =>
      set((state) => {
        if (state.toasts.some((t) => t.type === "warning" && t.title === message && t.message === detail)) return state;
        return { toasts: [...state.toasts, { type: "warning", title: message, message: detail, id: `toast-${Date.now()}` }] };
      }),
    info: (message: string, detail?: string) =>
      set((state) => {
        if (state.toasts.some((t) => t.type === "info" && t.title === message && t.message === detail)) return state;
        return { toasts: [...state.toasts, { type: "info", title: message, message: detail, id: `toast-${Date.now()}` }] };
      }),
    setLoading: (key: string, loading: boolean) =>
      set((state) => ({ loadingStates: { ...state.loadingStates, [key]: loading } })),
    isLoading: (key: string) => get().loadingStates[key] ?? false,
    startLoading: (key: string) =>
      set((state) => ({ loadingStates: { ...state.loadingStates, [key]: true } })),
    stopLoading: (key: string) =>
      set((state) => ({ loadingStates: { ...state.loadingStates, [key]: false } })),
  })
);
